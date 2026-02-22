// Declaração de tipos para turndown-plugin-gfm (sem @types disponível)
declare module "turndown-plugin-gfm" {
  import TurndownService from "turndown";

  /** Plugin completo GFM (tabelas + strikethrough + task lists) */
  export const gfm: TurndownService.Plugin;

  /** Converte <table> HTML em tabelas pipe do GitHub Flavored Markdown */
  export const tables: TurndownService.Plugin;

  /** Converte <del>/<s> em ~~texto~~ */
  export const strikethrough: TurndownService.Plugin;

  /** Converte <input type="checkbox"> em - [x] / - [ ] */
  export const taskListItems: TurndownService.Plugin;
}
