import { load } from 'cheerio';

// Supply the small DOM surface used by the existing source parsers, without a
// process-global DOM shim or browser dependency in the function bundle.
export function parseMarkup(markup: string, xml = false): Document {
  const $ = load(markup, { xmlMode: xml });
  function wrap(element: Parameters<typeof $>[0]): Element {
    const node = $(element);
    return {
      textContent: node.text(),
      querySelector(selector: string) { const found = node.find(selector).first(); return found.length ? wrap(found) : null; },
      querySelectorAll(selector: string) { return node.find(selector).toArray().map(item => wrap(item)); },
    } as unknown as Element;
  }
  return {
    querySelector(selector: string) { const found = $(selector).first(); return found.length ? wrap(found) : null; },
    querySelectorAll(selector: string) { return $(selector).toArray().map(item => wrap(item)); },
    getElementById(id: string) { const found = $('[id]').filter((_, element) => $(element).attr('id') === id).first(); return found.length ? wrap(found) : null; },
  } as unknown as Document;
}
