import type { Face } from "./face.js";
import { helper as assist } from "./helper.js";
import DefaultThing from "./default.js";
import * as Space from "./space.js";
import { type MixedType, value as localValue } from "./mixed.js";
export { shared as publicShared } from "./shared.js";
export const exportedValue = 1;

interface LocalFace extends Face, Domain.Parent {
  value: Box<Item>;
}

enum State { Ready, Done }
type Identifier = Domain.Id;
module LegacyModule { export const enabled = true; }

/** Public service documentation. */
@sealed
export class Outer extends Base<ParentArg> implements Face, Domain.Generic<Item> {
  readonly label = "service";

  constructor(service: Service) {}

  shape(): { value: string } { return { value: "ok" }; }

  run(input: string): void;
  run(input: number): void;
  run(input: string | number): void {
    const created = new Service(input);
    assist(input);
    fetch("/api/items");
    axios.post("https://example.test/items", input);
    emitter.emit("completed", input);
    emitter.once("completed", handle);
    emit("bare", input);
    on("bare", handle);
    render(<section>{input}</section>);
    label("ordinary text");
    gql`query Item { item }`;
    const message = "emitter.emit('not-an-event')";
    const shape = { emit: "not-a-call", on: "not-a-listener" };
    void message;
    void shape;
    void created;
    void DefaultThing;
    void Space;
  }
}

namespace Tools {
  export function nested(value: string): string {
    return value;
  }
}

function sealed<T extends new (...args: any[]) => object>(target: T): T {
  return target;
}

async function lazyLoad(): Promise<unknown> {
  return import("./lazy.js");
}
