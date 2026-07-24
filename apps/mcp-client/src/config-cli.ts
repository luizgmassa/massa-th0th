#!/usr/bin/env bun

import {
  getConfigDir,
  getConfigPath,
  configExists,
  loadConfig,
  saveConfig,
  initConfig,
  defaultMassaAiConfig,
} from "@massa-ai/shared/config";

const args = process.argv.slice(2);
const command = args[0];

function help() {
  console.log(`
massa-ai-config - Configuration manager for massa-ai

Usage:
  massa-ai-config <command> [options]

Commands:
  init              Initialize massa-ai configuration
    --ollama          Use Ollama (local, default)
    --mistral <key>   Use Mistral with API key
    --openai <key>    Use OpenAI with API key

  path              Show config file path
  show              Show current configuration
  set <key> <val>   Set a configuration value
  use <provider>    Switch embedding provider
    --api-key <key>   API key (required for mistral/openai)
    --model <name>    Model name
    --base-url <url>  Base URL (for ollama)

  recover           Re-associate a project index with a new filesystem path
    <projectId>       Project ID to recover
    --path <newPath>  New filesystem path

Examples:
  massa-ai-config init
  massa-ai-config init --mistral your-api-key
  massa-ai-config use ollama --model qwen3-embedding:8b
  massa-ai-config use mistral --api-key your-key
  massa-ai-config set embedding.dimensions 1024
  massa-ai-config recover my-project --path /home/user/renamed-dir
`);
}

function parseOptions(args: string[]): Record<string, string | boolean> {
  const options: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        options[key] = args[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    }
  }
  return options;
}

if (!command || command === "--help" || command === "-h") {
  help();
  process.exit(0);
}

const options = parseOptions(args.slice(1));

switch (command) {
  case "init": {
    initConfig();
    
    if (options.mistral && typeof options.mistral === "string") {
      const config = loadConfig();
      config.embedding = {
        provider: "mistral",
        model: "mistral-embed",
        apiKey: options.mistral,
        dimensions: 1024,
      };
      saveConfig(config);
      console.log("✓ Configured for Mistral embeddings");
    } else if (options.openai && typeof options.openai === "string") {
      const config = loadConfig();
      config.embedding = {
        provider: "openai",
        model: "text-embedding-3-small",
        apiKey: options.openai,
        dimensions: 1536,
      };
      saveConfig(config);
      console.log("✓ Configured for OpenAI embeddings");
    } else {
      console.log("✓ Configured for Ollama (local) embeddings");
    }
    
    console.log(`\nConfig file: ${getConfigPath()}`);
    break;
  }

  case "path": {
    console.log(getConfigPath());
    break;
  }

  case "show": {
    if (!configExists()) {
      console.log("No config file found. Run `massa-ai-config init` to create one.");
      console.log("\nUsing defaults:");
      console.log(JSON.stringify(defaultMassaAiConfig, null, 2));
      process.exit(0);
    }
    
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
    break;
  }

  case "set": {
    const key = args[1];
    const value = args[2];
    
    if (!key || !value) {
      console.error("Usage: massa-ai-config set <key> <value>");
      process.exit(1);
    }
    
    const config = loadConfig();
    const keys = key.split(".");
    let obj: Record<string, unknown> = config as unknown as Record<string, unknown>;
    
    for (let i = 0; i < keys.length - 1; i++) {
      obj = obj[keys[i]] as Record<string, unknown>;
    }
    
    const parsedValue = isNaN(Number(value)) ? value : Number(value);
    obj[keys[keys.length - 1]] = parsedValue;
    saveConfig(config);
    console.log(`✓ Set ${key} = ${value}`);
    break;
  }

  case "use": {
    const provider = args[1];
    
    if (!provider || !["ollama", "mistral", "openai"].includes(provider)) {
      console.error("Provider must be: ollama, mistral, or openai");
      process.exit(1);
    }
    
    const config = loadConfig();
    
    if (provider === "ollama") {
      config.embedding = {
        provider: "ollama",
        model: (options.model as string) || "qwen3-embedding:8b",
        baseURL: (options["base-url"] as string) || "http://localhost:11434",
        dimensions: 768,
      };
    } else if (provider === "mistral") {
      if (!options["api-key"]) {
        console.error("Error: --api-key required for Mistral");
        process.exit(1);
      }
      config.embedding = {
        provider: "mistral",
        model: (options.model as string) || "mistral-embed",
        apiKey: options["api-key"] as string,
        dimensions: 1024,
      };
    } else if (provider === "openai") {
      if (!options["api-key"]) {
        console.error("Error: --api-key required for OpenAI");
        process.exit(1);
      }
      config.embedding = {
        provider: "openai",
        model: (options.model as string) || "text-embedding-3-small",
        apiKey: options["api-key"] as string,
        dimensions: 1536,
      };
    }
    
    saveConfig(config);
    console.log(`✓ Switched to ${provider} embeddings`);
    console.log(`  Model: ${config.embedding.model}`);
    break;
  }

  case "recover": {
    const projectId = args[1];
    const newPath = options.path as string | undefined;

    if (!projectId) {
      console.error("Error: projectId required. Usage: massa-ai-config recover <projectId> --path <newPath>");
      process.exit(1);
    }
    if (!newPath || typeof newPath !== "string") {
      console.error("Error: --path required. Usage: massa-ai-config recover <projectId> --path <newPath>");
      process.exit(1);
    }

    try {
      const { recoverProjectPath } = await import("./recover-project.js");
      const result = await recoverProjectPath(projectId, newPath);
      if (!result.found) {
        console.error(`Error: project "${projectId}" not found. Cannot recover — the project must be indexed first.`);
        process.exit(1);
      }
      console.log(`✓ Recovered project "${projectId}" — path updated to ${newPath}`);
      console.log(`  Previous path: ${result.oldPath ?? "(none)"}`);
    } catch (e) {
      const err = e as Error;
      console.error(`Error: recovery failed — ${err.message}`);
      process.exit(1);
    }
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
