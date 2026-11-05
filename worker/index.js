const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

const MAX_IMAGE_LENGTH = 8_000_000;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function parseGeminiText(data) {
  return data.candidates?.[0]?.content?.parts?.map(part => part.text || "").join("") || "";
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

  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY
    },
    body: JSON.stringify({
      contents,
      generationConfig: image
        ? { temperature: 0.2, responseMimeType: "application/json" }
        : { temperature: 0.2 }
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Gemini respondeu HTTP ${response.status}.`);
  return parseGeminiText(data);
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
  }

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${env.GROQ_API_KEY}`
    },
    body: JSON.stringify({
      model: image ? "qwen/qwen3.8-27b" : "openai/gpt-oss-20b",
      messages: chat,
      temperature: 0.2,
      ...(image ? { response_format: { type: "json_object" }, max_completion_tokens: 900 } : {})
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || `Groq respondeu HTTP ${response.status}.`);
  return data.choices?.[0]?.message?.content || "";
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

  const configured = { gemini: Boolean(env.GEMINI_API_KEY), groq: Boolean(env.GROQ_API_KEY) };
  const fallbackProvider = requestedProvider === "gemini" ? "groq" : "gemini";
  const provider = configured[requestedProvider] ? requestedProvider : fallbackProvider;
  if (!configured[provider]) {
    return json({ error: "Nenhum provedor de IA está configurado no Worker. Cadastre GEMINI_API_KEY ou GROQ_API_KEY no Cloudflare." }, 503);
  }

  try {
    const text = provider === "gemini"
      ? await askGemini(env, body.prompt || "", body.messages, image)
      : await askGroq(env, body.prompt || "", body.messages, image);
    return json({ text, provider, fallback: provider !== requestedProvider });
  } catch (error) {
    if (/rate limit|OTPM|output tokens per minute/i.test(error.message || "")) {
      return json({ error: "O limite temporário da Groq foi atingido. Aguarde cerca de um minuto e tente novamente. Se acontecer com frequência, envie menos linhas por foto ou aumente o limite do plano." }, 429);
    }
    return json({ error: error.message || "Falha ao consultar o provedor de IA." }, 502);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  }
};