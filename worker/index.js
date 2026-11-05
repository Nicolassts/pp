const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

const MAX_IMAGE_LENGTH = 10_000_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function parseGeminiText(data) {
  return data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
}

function cleanJsonString(str) {
  return str
    .replace(/\/\*[\s\S]*?\*\/|([^:]|^)\/\/.*$/gm, "")
    .replace(/,\s*([\]}])/g, "$1");
}

function validateImageJSON(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("A leitura da imagem retornou JSON incompleto.");
  let result;
  const raw = text.slice(start, end + 1);
  try {
    result = JSON.parse(raw);
  } catch {
    try {
      result = JSON.parse(cleanJsonString(raw));
    } catch {
      throw new Error("A leitura da imagem retornou JSON incompleto.");
    }
  }
  if (!result || !Array.isArray(result.dias)) throw new Error("A leitura da imagem não trouxe uma lista de dias válida.");
}

async function askGemini(env, prompt, messages, image) {
  if (!env.GEMINI_API_KEY) throw new Error("A chave GEMINI_API_KEY não foi configurada.");
  const contents = messages?.length
    ? messages.map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: message.content }]
    }))
    : [{ role: "user", parts: [{ text: prompt }] }];

  if (image) {
    const lastUser = [...contents].reverse().find(item => item.role === "user");
    lastUser.parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
  }

  const models = [
    env.GEMINI_MODEL,
    "gemini-3.8-flash",
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash"
  ].filter(Boolean);

  let lastError = null;
  for (const model of models) {
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-api-key": env.GEMINI_API_KEY
        },
        body: JSON.stringify({
          contents,
          systemInstruction: image ? {
            parts: [{ text: "Você é um assistente especialista em OCR e visão computacional de quadros industriais de PCP. Sua prioridade máxima é extrair SEMPRE todas as 4 linhas de produção (Linha 1, Linha 2, Linha 3 e Linha 4) do quadro. Nunca pare apenas na Linha 1. É mandatório extrair as 4 linhas completas em JSON." }]
          } : undefined,
          generationConfig: image
            ? { temperature: 0.1, responseMimeType: "application/json", maxOutputTokens: 8192 }
            : { temperature: 0.2, maxOutputTokens: 2048 }
        })
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 404 || /not found|unsupported/i.test(data.error?.message || "")) {
          lastError = new Error(data.error?.message || `Modelo ${model} não encontrado.`);
          continue;
        }
        throw new Error(data.error?.message || `Gemini respondeu HTTP ${response.status}.`);
      }
      return parseGeminiText(data);
    } catch (err) {
      lastError = err;
      if (!/404|not found|unsupported/i.test(err.message)) throw err;
    }
  }
  throw lastError || new Error("Falha ao consultar os modelos Gemini.");
}

async function askGroq(env, prompt, messages, image) {
  if (!env.GROQ_API_KEY) throw new Error("A chave GROQ_API_KEY não foi configurada.");
  const chat = messages?.length
    ? messages.map(message => ({ role: message.role, content: message.content }))
    : [{ role: "user", content: prompt }];

  if (image) {
    const lastUser = [...chat].reverse().find(item => item.role === "user");
    lastUser.content = [
      { type: "text", text: lastUser.content },
      { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data}` } }
    ];
    chat.unshift({
      role: "system",
      content: "Você é um assistente especialista em OCR e visão computacional de quadros industriais de PCP. Sua prioridade máxima é extrair SEMPRE todas as 4 linhas de produção (Linha 1, Linha 2, Linha 3 e Linha 4) do quadro. Nunca pare apenas na Linha 1. É mandatório extrair as 4 linhas completas e retornar em JSON válido."
    });
  }

  const visionModels = [
    env.GROQ_VISION_MODEL,
    "qwen/qwen3.8-27b",
    "llama-3.2-11b-vision-preview",
    "llama-3.2-90b-vision-preview"
  ].filter(Boolean);

  const textModels = [
    env.GROQ_TEXT_MODEL,
    "openai/gpt-oss-20b",
    "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant"
  ].filter(Boolean);

  const candidateModels = image ? visionModels : textModels;
  let lastError = null;

  for (const model of candidateModels) {
    try {
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages: chat,
          temperature: 0.1,
          ...(image ? { response_format: { type: "json_object" }, max_completion_tokens: 8192 } : { max_completion_tokens: 2048 })
        })
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 404 || /model_not_found|does not exist/i.test(data.error?.message || "")) {
          lastError = new Error(data.error?.message || `Modelo Groq ${model} indisponível.`);
          continue;
        }
        throw new Error(data.error?.message || `Groq respondeu HTTP ${response.status}.`);
      }
      return data.choices?.[0]?.message?.content || "";
    } catch (err) {
      lastError = err;
      if (!/404|not found|does not exist/i.test(err.message)) throw err;
    }
  }
  throw lastError || new Error("Falha ao consultar os modelos Groq.");
}

async function handleApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/complete") return json({ error: "Rota não encontrada." }, 404);
  if (request.method !== "POST") return json({ error: "Método não permitido." }, 405);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Corpo JSON inválido." }, 400);
  }

  const requestedProvider = body.provider || env.DEFAULT_AI_PROVIDER || "gemini";
  if (!["gemini", "groq"].includes(requestedProvider)) return json({ error: "Provedor inválido." }, 400);
  if (typeof body.prompt !== "string" && !Array.isArray(body.messages)) {
    return json({ error: "Informe um prompt ou mensagens." }, 400);
  }
  if (body.prompt && body.prompt.length > 30_000) return json({ error: "Prompt muito longo." }, 413);
  if (body.messages && (body.messages.length > 30 || body.messages.some(message =>
    !["user", "assistant"].includes(message.role) || typeof message.content !== "string" || message.content.length > 30_000
  ))) return json({ error: "Histórico de conversa inválido ou muito longo." }, 400);

  const image = body.image;
  if (image && (!IMAGE_TYPES.has(image.mimeType) || typeof image.data !== "string" ||
    image.data.length > MAX_IMAGE_LENGTH || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data))) {
    return json({ error: "Imagem inválida ou acima do limite de tamanho." }, 400);
  }

  const configured = ["gemini", "groq"].filter(provider =>
    provider === "gemini" ? Boolean(env.GEMINI_API_KEY) : Boolean(env.GROQ_API_KEY)
  );
  if (!configured.length) {
    return json({ error: "Nenhum provedor de IA está configurado no Worker. Cadastre GEMINI_API_KEY ou GROQ_API_KEY no Cloudflare." }, 503);
  }

  const providers = [requestedProvider, ...configured.filter(provider => provider !== requestedProvider)]
    .filter(provider => configured.includes(provider));
  const failures = [];
  for (const provider of providers) {
    try {
      const text = provider === "gemini"
        ? await askGemini(env, body.prompt || "", body.messages, image)
        : await askGroq(env, body.prompt || "", body.messages, image);
      if (!text.trim()) throw new Error("O provedor devolveu uma resposta vazia.");
      if (image) validateImageJSON(text);
      return json({ text, provider, fallback: provider !== requestedProvider });
    } catch (error) {
      failures.push(`${provider}: ${error.message || "falha desconhecida"}`);
    }
  }

  const rateLimited = failures.some(message => /rate limit|OTPM|output tokens per minute/i.test(message));
  const message = rateLimited
    ? "Os provedores de IA estão temporariamente no limite. Aguarde um minuto e tente novamente."
    : failures.join(" | ");
  return json({ error: message || "Falha ao consultar os provedores de IA." }, rateLimited ? 429 : 502);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  }
};