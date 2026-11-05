const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const appPath = path.join(__dirname, "..", "separado", "app.js");
const appSource = fs.readFileSync(appPath, "utf8");

function between(source, start, end) {
  const first = source.indexOf(start);
  const last = source.indexOf(end, first);
  assert.notEqual(first, -1, `Missing source marker: ${start}`);
  assert.notEqual(last, -1, `Missing source marker: ${end}`);
  return source.slice(first, last);
}

function loadLogic() {
  const code = [
    between(appSource, "const norm=", "const cliOf="),
    between(appSource, "const num=", "const skus="),
    between(appSource, "function recipeCells", "Object.values(RECS)"),
    between(appSource, "function parsePlan", '$("read").onclick=async()=>'),
    "globalThis.logic={num,parseRec,normalizePlan};"
  ].join("\n");
  const context = { Date };
  vm.runInNewContext(code, context);
  return context.logic;
}

test("recipe parser preserves dot and comma decimals and recognizes sections", () => {
  const logic = loadLogic();
  const recipe = logic.parseRec([
    "Seção\tMassa",
    "1\tFarinha\t0.025\t0\t0.025\t0",
    "2\tAçúcar\t0,975\t0\t0,975\t0",
    "Seção\tRecheio",
    "3\tChocolate\t1.0000\t0\t1.0000\t0"
  ].join("\n"));

  assert.equal(logic.num("0.025"), 0.025);
  assert.equal(logic.num("0,025"), 0.025);
  assert.deepEqual(Array.from(recipe, item => item.sec), ["massa", "massa", "recheio"]);
  assert.equal(recipe[2].base, 1);
});

test("recipe parser accepts semicolon-delimited pasted rows", () => {
  const recipe = loadLogic().parseRec('1;"Farinha; especial";0,025;0;0,025;1,5%');
  assert.equal(recipe.length, 1);
  assert.equal(recipe[0].nome, "Farinha; especial");
  assert.equal(recipe[0].base, 0.025);
  assert.equal(recipe[0].perda, 1.5);
});

test("planning parser normalizes localized kilograms and dates", () => {
  const result = loadLogic().normalizePlan(JSON.stringify({
    periodo: "Outubro/2026",
    dias: [{ linha: "1", data: "16/10", plan: "5.000", sku: "Teste", obs: "" }]
  }));
  assert.equal(result.dias[0].linha, 1);
  assert.equal(result.dias[0].data, "2026-10-16");
  assert.equal(result.dias[0].plan, 5000);
});

test("planning parser refuses responses without usable days", () => {
  assert.throws(() => loadLogic().normalizePlan('{"periodo":"Outubro/2026","dias":[]}'), /Não encontrei dias válidos/);
});

test("planning parser preserves a row with an impossible date for correction", () => {
  const result = loadLogic().normalizePlan(JSON.stringify({
    periodo: "Fevereiro/2026",
    dias: [{ linha: 1, data: "31/02/2026", plan: 5000, sku: "Teste" }]
  }));
  assert.equal(result.dias.length, 1);
  assert.equal(result.dias[0].data, "");
  assert.equal(result.dias[0].plan, 5000);
});

test("planning parser handles line strings, tons, units and bare days", () => {
  const result = loadLogic().normalizePlan(JSON.stringify({
    periodo: "Novembro/2026",
    dias: [
      { linha: "Linha 2", data: "15", plan: "5.5 t", sku: "HER-DUO", obs: "DESIN" },
      { linha: "L3", data: "16", plan: "10.000 kg", sku: '"', obs: "" }
    ]
  }));
  assert.equal(result.dias.length, 2);
  assert.equal(result.dias[0].linha, 2);
  assert.equal(result.dias[0].data, "2026-11-15");
  assert.equal(result.dias[0].plan, 5500);
  assert.equal(result.dias[0].sku, "HER-DUO");
  assert.equal(result.dias[0].obs, "DESIN");

  assert.equal(result.dias[1].linha, 3);
  assert.equal(result.dias[1].data, "2026-11-16");
  assert.equal(result.dias[1].plan, 10000);
  // ditto mark propagated from same line
});

test("planning parser tolerates trailing commas in JSON", () => {
  const jsonWithTrailing = `{"periodo": "Outubro/2026", "dias": [{"linha": 1, "data": "2026-10-01", "plan": 5000, "sku": "Teste",},],}`;
  const result = loadLogic().normalizePlan(jsonWithTrailing);
  assert.equal(result.dias.length, 1);
  assert.equal(result.dias[0].plan, 5000);
});