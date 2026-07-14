import type { SourcePoint, SourceSpan } from "./types.js";

export interface LegacyLineRange {
  /** One-based inclusive line containing the span start. */
  lineStart: number;
  /** One-based inclusive line containing span content. */
  lineEnd: number;
}

function assertPoint(point: SourcePoint, label: string): void {
  if (!Number.isInteger(point.row) || point.row < 0) {
    throw new RangeError(`${label}.row must be a non-negative integer`);
  }
  if (!Number.isInteger(point.column) || point.column < 0) {
    throw new RangeError(`${label}.column must be a non-negative integer`);
  }
}

/** Byte-addressed index over one immutable snapshot of UTF-8 source. */
export class SourceIndex {
  readonly #source: Buffer;
  readonly #lineStarts: readonly number[];

  constructor(source: string | Buffer) {
    this.#source = Buffer.from(source);
    new TextDecoder("utf-8", { fatal: true }).decode(this.#source);

    const starts = [0];
    for (let index = 0; index < this.#source.length; index += 1) {
      const byte = this.#source[index]!;
      if (byte === 0x0a) {
        starts.push(index + 1);
      }
    }
    this.#lineStarts = Object.freeze(starts);
  }

  get byteLength(): number {
    return this.#source.length;
  }

  /** Defensive copy: callers cannot mutate indexed source after construction. */
  sourceBytes(): Buffer {
    return Buffer.from(this.#source);
  }

  lineStarts(): readonly number[] {
    return this.#lineStarts;
  }

  pointAt(byteOffset: number): SourcePoint {
    this.#assertByteOffset(byteOffset, "byteOffset");
    let low = 0;
    let high = this.#lineStarts.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      if (this.#lineStarts[middle]! <= byteOffset) low = middle + 1;
      else high = middle - 1;
    }
    const row = Math.max(0, high);
    return { row, column: byteOffset - this.#lineStarts[row]! };
  }

  span(startByte: number, endByte: number): SourceSpan {
    this.#assertRange(startByte, endByte);
    return {
      startByte,
      endByte,
      start: this.pointAt(startByte),
      end: this.pointAt(endByte),
    };
  }

  validateSpan(span: SourceSpan): SourceSpan {
    assertPoint(span.start, "span.start");
    assertPoint(span.end, "span.end");
    this.#assertRange(span.startByte, span.endByte);
    const expectedStart = this.pointAt(span.startByte);
    const expectedEnd = this.pointAt(span.endByte);
    if (
      span.start.row !== expectedStart.row ||
      span.start.column !== expectedStart.column ||
      span.end.row !== expectedEnd.row ||
      span.end.column !== expectedEnd.column
    ) {
      throw new RangeError("SourceSpan points do not match its UTF-8 byte offsets");
    }
    return span;
  }

  snippetBytes(span: SourceSpan): Buffer {
    this.validateSpan(span);
    return Buffer.from(this.#source.subarray(span.startByte, span.endByte));
  }

  snippet(span: SourceSpan): string {
    return this.snippetBytes(span).toString("utf8");
  }

  /** Remap a child-parser span relative to an exact host byte slice. */
  remapChildSpan(hostSlice: SourceSpan, childSpan: SourceSpan): SourceSpan {
    this.validateSpan(hostSlice);
    const childSource = this.#source.subarray(hostSlice.startByte, hostSlice.endByte);
    const childIndex = new SourceIndex(childSource);
    childIndex.validateSpan(childSpan);
    return this.span(
      hostSlice.startByte + childSpan.startByte,
      hostSlice.startByte + childSpan.endByte,
    );
  }

  #assertRange(startByte: number, endByte: number): void {
    this.#assertByteOffset(startByte, "startByte");
    this.#assertByteOffset(endByte, "endByte");
    if (endByte < startByte) {
      throw new RangeError("endByte must be greater than or equal to startByte");
    }
  }

  #assertByteOffset(byteOffset: number, label: string): void {
    if (!Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset > this.#source.length) {
      throw new RangeError(`${label} is outside the source byte range`);
    }
    if (
      byteOffset < this.#source.length &&
      (this.#source[byteOffset]! & 0xc0) === 0x80
    ) {
      throw new RangeError(`${label} splits a UTF-8 code point`);
    }
  }
}

/** Derive legacy one-based inclusive line fields from an end-exclusive span. */
export function deriveLegacyLineRange(span: SourceSpan): LegacyLineRange {
  assertPoint(span.start, "span.start");
  assertPoint(span.end, "span.end");
  if (span.endByte < span.startByte) {
    throw new RangeError("span.endByte must be greater than or equal to span.startByte");
  }
  const lineStart = span.start.row + 1;
  if (span.startByte === span.endByte) return { lineStart, lineEnd: lineStart };
  const lineEnd = span.end.column === 0 ? span.end.row : span.end.row + 1;
  return { lineStart, lineEnd: Math.max(lineStart, lineEnd) };
}
