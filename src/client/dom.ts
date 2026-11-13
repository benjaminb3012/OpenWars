/** Tiny DOM helpers (no framework, no virtual DOM). */

export type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Record<string, string | number | boolean | undefined> = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (key === "class") element.className = String(value);
    else if (key === "text") element.textContent = String(value);
    else if (key === "html") element.innerHTML = String(value);
    else element.setAttribute(key, value === true ? "" : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return element;
}

export function clear(node: HTMLElement): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function button(
  label: string,
  onClick: () => void,
  options: { class?: string; title?: string; disabled?: boolean } = {},
): HTMLButtonElement {
  const element = el("button", {
    class: options.class ?? "btn",
    type: "button",
    title: options.title,
    disabled: options.disabled,
  });
  element.textContent = label;
  element.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!element.disabled) onClick();
  });
  return element;
}

export function bar(value: number, max: number, className: string): HTMLElement {
  const wrapper = el("div", { class: `bar ${className}` });
  const fill = el("div", { class: "bar-fill" });
  fill.style.width = `${Math.max(0, Math.min(100, (value / max) * 100))}%`;
  wrapper.append(fill);
  return wrapper;
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
