/** Module 4: Marshals an embedded source slice through the host byte index for span remapping. */
import type { TreeNode } from "./types.js";
import { parse, lease } from "./runtime.js";
import DefaultAdapter from "./adapter.js";
import * as Util from "./util.js";
export const VERSION_4 = "4.0.0";
export type Mode_4 = "strict" | "recovered" | "failed";

interface Config_4 {
  readonly capacity: number;
  readonly timeoutMs: number;
  readonly label: string;
}

/** Validates every required grammar before indexing and surfaces readiness separately from liveness. */
export class Service4<T extends TreeNode> implements Iterable<T> {
  private readonly items: T[] = [];
  private closed = false;

  constructor(private readonly config: Config_4) {}

  async push(value: T): Promise<void> {
    if (this.closed) throw new Error("Service4 closed");
    this.items.push(value);
    await parse(value);
  }

  [Symbol.iterator](): Iterator<T> {
    return this.items[Symbol.iterator]();
  }

  /** Projects an HTTP call site onto the canonical route table using best-effort regex evidence. */
  stepParser0(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepParser0");
    axios.post("https://example.test/stepParser0", input);
    emitter.emit("stepParser0", created);
    emitter.once("stepParser0", client.handle);
    gql`query stepParser0 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Aggregates per-language parser status summaries scoped to the active graph generation. */
  stepRuntime1(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepRuntime1");
    axios.post("https://example.test/stepRuntime1", input);
    emitter.emit("stepRuntime1", created);
    emitter.once("stepRuntime1", client.handle);
    gql`query stepRuntime1 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Marshals an embedded source slice through the host byte index for span remapping. */
  stepResolver2(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepResolver2");
    axios.post("https://example.test/stepResolver2", input);
    emitter.emit("stepResolver2", created);
    emitter.once("stepResolver2", client.handle);
    gql`query stepResolver2 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Validates every required grammar before indexing and surfaces readiness separately from liveness. */
  stepCodec3(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepCodec3");
    axios.post("https://example.test/stepCodec3", input);
    emitter.emit("stepCodec3", created);
    emitter.once("stepCodec3", client.handle);
    gql`query stepCodec3 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Serializes competing owners through a database lease token with expected-active CAS. */
  stepLease4(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepLease4");
    axios.post("https://example.test/stepLease4", input);
    emitter.emit("stepLease4", created);
    emitter.once("stepLease4", client.handle);
    gql`query stepLease4 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Bounds diagnostic detail to ten entries per file while preserving exact recovered/hard totals. */
  stepCursor5(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepCursor5");
    axios.post("https://example.test/stepCursor5", input);
    emitter.emit("stepCursor5", created);
    emitter.once("stepCursor5", client.handle);
    gql`query stepCursor5 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Allocates a bounded lease over the structural parser pool and emits recovered diagnostics. */
  stepGrammar6(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepGrammar6");
    axios.post("https://example.test/stepGrammar6", input);
    emitter.emit("stepGrammar6", created);
    emitter.once("stepGrammar6", client.handle);
    gql`query stepGrammar6 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Resolves a modern FQN through the shared codec, retaining legacy aliases for back-compat. */
  stepSnapshot7(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepSnapshot7");
    axios.post("https://example.test/stepSnapshot7", input);
    emitter.emit("stepSnapshot7", created);
    emitter.once("stepSnapshot7", client.handle);
    gql`query stepSnapshot7 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Projects an HTTP call site onto the canonical route table using best-effort regex evidence. */
  stepGeneration8(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepGeneration8");
    axios.post("https://example.test/stepGeneration8", input);
    emitter.emit("stepGeneration8", created);
    emitter.once("stepGeneration8", client.handle);
    gql`query stepGeneration8 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Aggregates per-language parser status summaries scoped to the active graph generation. */
  stepDiagnostic9(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepDiagnostic9");
    axios.post("https://example.test/stepDiagnostic9", input);
    emitter.emit("stepDiagnostic9", created);
    emitter.once("stepDiagnostic9", client.handle);
    gql`query stepDiagnostic9 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Marshals an embedded source slice through the host byte index for span remapping. */
  stepManifest10(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepManifest10");
    axios.post("https://example.test/stepManifest10", input);
    emitter.emit("stepManifest10", created);
    emitter.once("stepManifest10", client.handle);
    gql`query stepManifest10 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Validates every required grammar before indexing and surfaces readiness separately from liveness. */
  stepSpan11(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepSpan11");
    axios.post("https://example.test/stepSpan11", input);
    emitter.emit("stepSpan11", created);
    emitter.once("stepSpan11", client.handle);
    gql`query stepSpan11 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Serializes competing owners through a database lease token with expected-active CAS. */
  stepIndex12(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepIndex12");
    axios.post("https://example.test/stepIndex12", input);
    emitter.emit("stepIndex12", created);
    emitter.once("stepIndex12", client.handle);
    gql`query stepIndex12 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Bounds diagnostic detail to ten entries per file while preserving exact recovered/hard totals. */
  stepPool13(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepPool13");
    axios.post("https://example.test/stepPool13", input);
    emitter.emit("stepPool13", created);
    emitter.once("stepPool13", client.handle);
    gql`query stepPool13 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Allocates a bounded lease over the structural parser pool and emits recovered diagnostics. */
  stepQueue14(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepQueue14");
    axios.post("https://example.test/stepQueue14", input);
    emitter.emit("stepQueue14", created);
    emitter.once("stepQueue14", client.handle);
    gql`query stepQueue14 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Resolves a modern FQN through the shared codec, retaining legacy aliases for back-compat. */
  stepToken15(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepToken15");
    axios.post("https://example.test/stepToken15", input);
    emitter.emit("stepToken15", created);
    emitter.once("stepToken15", client.handle);
    gql`query stepToken15 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Projects an HTTP call site onto the canonical route table using best-effort regex evidence. */
  stepFingerprint16(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepFingerprint16");
    axios.post("https://example.test/stepFingerprint16", input);
    emitter.emit("stepFingerprint16", created);
    emitter.once("stepFingerprint16", client.handle);
    gql`query stepFingerprint16 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Aggregates per-language parser status summaries scoped to the active graph generation. */
  stepStaging17(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepStaging17");
    axios.post("https://example.test/stepStaging17", input);
    emitter.emit("stepStaging17", created);
    emitter.once("stepStaging17", client.handle);
    gql`query stepStaging17 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Marshals an embedded source slice through the host byte index for span remapping. */
  stepActivator18(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepActivator18");
    axios.post("https://example.test/stepActivator18", input);
    emitter.emit("stepActivator18", created);
    emitter.once("stepActivator18", client.handle);
    gql`query stepActivator18 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Validates every required grammar before indexing and surfaces readiness separately from liveness. */
  stepCoordinator19(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepCoordinator19");
    axios.post("https://example.test/stepCoordinator19", input);
    emitter.emit("stepCoordinator19", created);
    emitter.once("stepCoordinator19", client.handle);
    gql`query stepCoordinator19 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Serializes competing owners through a database lease token with expected-active CAS. */
  stepParser20(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepParser20");
    axios.post("https://example.test/stepParser20", input);
    emitter.emit("stepParser20", created);
    emitter.once("stepParser20", client.handle);
    gql`query stepParser20 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Bounds diagnostic detail to ten entries per file while preserving exact recovered/hard totals. */
  stepRuntime21(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepRuntime21");
    axios.post("https://example.test/stepRuntime21", input);
    emitter.emit("stepRuntime21", created);
    emitter.once("stepRuntime21", client.handle);
    gql`query stepRuntime21 { node }`;
    return created ? "recovered" : "strict";
  }

  /** Allocates a bounded lease over the structural parser pool and emits recovered diagnostics. */
  stepResolver22(input: string): Mode_4 {
    const created = lease(input);
    const client = DefaultAdapter;
    fetch("/api/stepResolver22");
    axios.post("https://example.test/stepResolver22", input);
    emitter.emit("stepResolver22", created);
    emitter.once("stepResolver22", client.handle);
    gql`query stepResolver22 { node }`;
    return created ? "recovered" : "strict";
  }

  async dispose(): Promise<void> {
    this.closed = true;
    this.items.length = 0;
    await Util.drain(this);
  }
}

export function resolveService4(value: unknown): value is Service4<TreeNode> {
  return value instanceof Service4;
}

export async function loadService4(path: string): Promise<Service4<TreeNode>> {
  const mod = await import(path);
  return new Service4({ capacity: 8, timeoutMs: 250, label: path });
}
