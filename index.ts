import process from "node:process";
import fs from "node:fs";
import assert from "node:assert";
import {GeneticConfig, geneticPass} from "./genetic";
import { CodeCandidate, geneticCodeConfig } from "./geneticCode";
import { execSync } from "node:child_process";

/*
(async() => {
const NUMBER_COUNT = 15;
const TARGET = 123;
let population: number[][] = [];
const config: GeneticConfig<number[], number> = {
  randomCandidate(random) {
    const result: number[] = [];
    for (let i = 0; i < NUMBER_COUNT; ++i) {
      result.push(random.int32() % 100);
    }
    return result;
  },
  simulateAndMeasureFitness: (candidate) => ({
    candidate,
    fitness: -Math.abs(candidate.reduce((accumulator, currentValue) => accumulator + currentValue, 0) - TARGET)
  }),
  compareFitness(a, b) {
    return a - b;
  },
  crossoverBreed(a, b, random) {
    const result: number[] = [];
    for (let i = 0; i < NUMBER_COUNT; ++i) {
      result.push(random() < 0.5 ? a[i] : b[i]);
    }
    return result;
  },
  mutate(candidate, mutationRate, random) {
    const result = [...candidate];
    for (let i = 0; i < NUMBER_COUNT; ++i) {
      if (random() < mutationRate) {
        result[i] = random.int32() % 100;
      }
    }
    return result;
  },
};
for (let i = 0; i < 1000; ++i) {
  const measured = await geneticPass(config, population);
  console.log(measured.map(pair => ({candidate: pair.candidate.join(" + "), fitness: pair.fitness})));
}
if ("s".startsWith("s")) {
  process.exit();
}
})();
*/


interface Execute {
  stdin?: string;
  timeout?: number;
}

// // Not technically asnyc, but doing this to keep our options open
const execute = async (command: string, options?: Execute): Promise<string> => {
  console.log(command);
  try {
    return execSync(command, {
      encoding: "utf8",
      timeout: options?.timeout,
      stdio: "pipe",
      input: options?.stdin,
      killSignal: "SIGKILL",
    });
  } catch (err) {
    console.log(err)
    return `${err}`;
  }
};

/*
(async () => {
  // Note I'd probably use https://github.com/YousefED/typescript-json-schema
  // however, node-llama-cpp has it's own grammar generator that currently does not support minItems
  const outputsTs = "./output.ts";
  const tsj = (await import("ts-json-schema-generator")).default;
  const config: import("ts-json-schema-generator").Config = {
    path: outputsTs,
    tsconfig: "./tsconfig.json",
    type: "OutputVideo",
    topRef: false,
    encodeRefs: false,
  };
  const tsjGenerator = tsj.createGenerator(config);
  const schema = tsjGenerator.createSchema(config.type);
  const schemaJson = JSON.stringify(schema, null, 2);
  console.log(schemaJson);
  assert(!schema.definitions || Object.values(schema.definitions).length === 0,
    `Schema should not have definitions, do not use 'export' on anything but the root: ${schemaJson}`);
})();
*/

(async () => {
  const llm = await import("node-llama-cpp");
  const llama = await llm.getLlama({
    logLevel: llm.LlamaLogLevel.disabled,
  });
  const model = await llama.loadModel({
    modelPath: "./models/Nous-Hermes-2-Mistral-7B-DPO.Q4_0.gguf"
    //modelPath: "./models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf",
  });

  const stressTestCase = "34,5,1,95,-4, 5 , 21, -1234, 5, 99999, 1,0,5,3,9,1,1,1";
  const testCases = [
    "5,3  ,9,1",
    "1",
    "1,2,3,4,5",
    "5,4,3,2,1",
    stressTestCase,
  ]
  //const testCases = [
  //  '{}',
  //  '{"foo": "bar"}',
  //  '5',
  //  'foo',
  //  '{"foo": 5}',
  //  '{"foo": 5, "goo": {}, "bar": "zoo"}',
  //  '{"foo": 5, "goo": {"wiz": "a"}, "bar": "zoo"}',
  //  '{'
  //]
  //const testCases = [
  //  '5 3',
  //  '1',
  //  '99 2',
  //  '1 200',
  //  '3 9',
  //  '2 2 2',
  //]
  //const testCases = [
  //  '{}',
  //  '0',
  //  'null',
  //  'true',
  //  'false',
  //  '[]',
  //  '[1]',
  //  '{"foo": "bar"}',
  //  '{"foo": 5}',
  //]

  const runSample = async (input: string): Promise<string> => {
    return execute("node clone.js", { stdin: input });
  };

  /*
  const LANGUAGE = "commented standard WASM/WASI with no other libraries";
  const LANGUAGE_GRAMMAR = 'root ::= "(module " [^\\x00]* ")"';
  const compileDest = async (source: string): Promise<string> => {
    await fs.promises.writeFile("/tmp/source.wat", source);
    return execute("wasmtime compile /tmp/source.wat");
  };

  const runDest = async (input: string): Promise<string> => {
    return execute("wasmtime /tmp/source.wat", { stdin: input, timeout: 10 * 1000 });
  };
  */

  const grammar = await llama.createGrammar({
    grammar: 'root ::= "#include" [^\\x00]*',
  });

  let prompting = false;
  
  const config = await geneticCodeConfig({
    populationSize: 30,
    language: "commented standard C with no libraries",
    sourceOrInstructions: await fs.promises.readFile("./clone.js", "utf8"),
    testInputs: testCases,
    runSample,

    async compile(candidate) {
      const sourceFile = `/tmp/${candidate.uniqueSeed}_source.c`;
      await fs.promises.writeFile(sourceFile, candidate.source);
      const output = await execute(`clang ${sourceFile} -g3 -o /tmp/${candidate.uniqueSeed}_compiled`);
      return output.replaceAll(sourceFile, "src.c");
    },

    async runCompiled(candidate, input) {
      const executeOpts: Execute = { stdin: input, timeout: 10 * 1000 };
      const result = await execute(`/tmp/${candidate.uniqueSeed}_compiled`, executeOpts);
      if (result.includes("Segmentation fault (core dumped)")) {
        return execute(`gdb -batch -q -ex run -ex bt --args /tmp/${candidate.uniqueSeed}_compiled`, executeOpts);
      } else {
        return result;
      }
    },

    async testPerformance(code) {
      // TODO(trevor): Don't know that this is a great approach or not
      for (let i = 0; i < 10; ++i) {
        await this.runCompiled(code, stressTestCase);
      }
    },

    async prompt(seed, prompt) {
      if (prompting) {
        throw new Error("CANNOT PROMPT TWICE");
      }
      prompting = true;
      const context = await model.createContext();
      const session = new llm.LlamaChatSession({
        contextSequence: context.getSequence(),
      });
  
      console.log("SEED:", seed, "PROMPT:", prompt);
      const result = await session.prompt(prompt, {
        temperature: 1.0,
        seed,
        grammar,
        onTextChunk(text) {
          process.stdout.write(text);
        },
      });
      process.stdout.write("\n");
      await session.dispose();
      await context.dispose();
      prompting = false;
      return result;
    },
  });

  let population: CodeCandidate[] = [];
  for (let i = 0; i < 30; ++i) {
    console.log(`+++ GENERATION ${i} +++`);
    const measured = await geneticPass(config, population);
    console.log(JSON.stringify(measured, null, 2));
  }
  console.log("COMPLETE");
})();
