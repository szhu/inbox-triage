// Vendored from https://github.com/szhu/el — a tiny hyperscript-style
// element-creation helper, kept as one small file rather than a dependency.

type ElChild = string | Element;
type ElProps = { tag?: string; children?: ElChild[]; [attribute: string]: any };

export function El(
  tagOrProps: string | ElProps,
  ...moreChildren: ElChild[]
): HTMLElement {
  const {
    tag = "div",
    children = [],
    ...attributes
  } = typeof tagOrProps === "string" ? { tag: tagOrProps } : tagOrProps;

  const el = document.createElement(tag);

  for (const [key, value] of Object.entries(attributes)) {
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2), value);
    } else if (value == null) {
      // Omit the attribute entirely.
    } else if (typeof value === "boolean") {
      if (value) el.setAttribute(key, "");
    } else {
      el.setAttribute(key, value);
    }
  }

  for (const child of [...children, ...moreChildren]) {
    el.appendChild(
      typeof child === "string" ? document.createTextNode(child) : child,
    );
  }

  return el;
}
