import React from "react";
import { renderCard } from "./render-card.js";
const legacy = require("./legacy.js");

export class Card extends Component {
  title = "card";
  #secret = 1;
  render(item) {
    renderCard(item);
    bus.addEventListener("ready", item);
    return <article>{item.name}</article>;
  }
}

export function load(id) {
  return fetch(`/api/cards/${id}`);
}

const arrow = (value) => renderCard(value);
