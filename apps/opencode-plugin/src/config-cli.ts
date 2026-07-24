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
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const args = process.argv.slice(2);
const command = args[0];

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  agents            Manage the 12 subagent specialist definitions
    agents install [--user|--project]   Write 12 agent .md files
    agents uninstall [--user|--project] Remove only massa-ai-owned agents

Examples:
  massa-ai-config init
  massa-ai-config init --mistral your-api-key
  massa-ai-config use ollama --model nomic-embed-text:latest
  massa-ai-config use mistral --api-key your-key
  massa-ai-config set embedding.dimensions 1024
  massa-ai-config agents install --user
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
        model: (options.model as string) || "nomic-embed-text:latest",
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

  case "agents": {
    const subcommand = args[1];
    if (subcommand !== "install" && subcommand !== "uninstall") {
      console.error("Usage: massa-ai-config agents <install|uninstall> [--user|--project]");
      process.exit(1);
    }
    const scope = typeof options.project === "boolean" ? "project" : "user";
    // OpenCode discovers agents from ~/.config/opencode/agents/ (user) or
    // .opencode/agents/ (project). These live OUTSIDE the npm package.
    const agentsDir =
      scope === "project"
        ? path.join(process.cwd(), ".opencode/agents")
        : path.join(
            (process.env.XDG_CONFIG_HOME && process.env.XDG_CONFIG_HOME.trim()) ||
              path.join(os.homedir(), ".config"),
            "opencode",
            "agents",
          );
    // Source agent files ship in the package's agents/ dir (sibling of dist/).
    // Resolve relative to this file so it works both from source (bun run) and
    // from the built bundle (dist/config-cli.js).
    const sourceAgentsDir = path.resolve(__dirname, "..", "agents");

    if (subcommand === "install") {
      await fs.mkdir(agentsDir, { recursive: true });
      let count = 0;
      const entries = await fs.readdir(sourceAgentsDir);
      for (const entry of entries) {
        if (!entry.startsWith("massa-ai-") || !entry.endsWith(".md")) continue;
        const src = path.join(sourceAgentsDir, entry);
        const dest = path.join(agentsDir, entry);
        await fs.copyFile(src, dest);
        count++;
      }
      console.log(
        `+ ${count} subagent specialists: investigator, planner, builder, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, test-engineer, documentation-agent, audit-specialist, mobile-specialist`,
      );
      console.log(`  written to: ${agentsDir}`);
    } else {
      // uninstall: remove only files with metadata: { massa-ai-owned: true }
      let removed = 0;
      try {
        const entries = await fs.readdir(agentsDir);
        for (const entry of entries) {
          if (!entry.startsWith("massa-ai-") || !entry.endsWith(".md")) continue;
          const filePath = path.join(agentsDir, entry);
          const content = await fs.readFile(filePath, "utf8");
          if (content.includes("massa-ai-owned: true")) {
            await fs.unlink(filePath);
            removed++;
          }
        }
      } catch (e: unknown) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      console.log(`- removed ${removed} massa-ai-owned agent files from ${agentsDir}`);
      console.log("  User agents preserved.");
    }
    break;
  }

  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
