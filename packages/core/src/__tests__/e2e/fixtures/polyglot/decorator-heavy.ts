// Decorator-heavy TypeScript fixture for native structural extraction.
import { Component, Input, Injectable } from "./fake-decorators";
import { ghost } from "./does-not-exist";

@Injectable()
@Component({
  selector: "poly-root",
  template: "<div>{{title}}</div>",
})
export class PolyRoot {
  @Input() title = "poly";

  @Component({
    selector: "poly-child",
  })
  decoratedMethod(): string {
    return this.title;
  }
}

export function polyFactory(): PolyRoot {
  return new PolyRoot();
}

export function usesGhost(value: number): number {
  return ghost(value);
}
