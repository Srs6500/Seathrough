export type DataOrigin = "hardcoded" | "mock" | "user" | "api" | "unknown";

export type ActionKind = "navigate" | "state" | "api" | "submit" | "none";

export type InspectKind =
  | "button"
  | "link"
  | "input"
  | "form"
  | "nav"
  | "card"
  | "heading"
  | "image"
  | "layout";

export type InspectArea =
  | "function"
  | "layout"
  | "responsive"
  | "data"
  | "a11y"
  | "performance";

export type InspectStates = {
  loading: boolean;
  empty: boolean;
  error: boolean;
  success: boolean;
  disabled: boolean;
};

export type InspectNote = {
  id: string;
  area: InspectArea;
  title: string;
  detail: string;
  next: string;
};

export type InspectTarget = {
  id: string;
  name: string;
  kind: InspectKind;
  tag: string;
  route: string;
  file: string;
  startLine: number;
  endLine: number;
  component: string;
  className: string;
  text: string;
  what: {
    summary: string;
    styles: string[];
    content: string;
    origin: DataOrigin;
    originDetail: string;
  };
  how: {
    action: ActionKind;
    actionDetail: string;
    usedOn: string[];
    sharedWith: string[];
    states: InspectStates;
  };
  attention: InspectNote[];
  nextStep: string;
  snippet: string;
};

export type InspectPage = {
  route: string;
  name: string;
  file: string;
};

export type InspectToken = {
  name: string;
  kind: "color" | "type" | "space";
  pages: string[];
};

export type InspectReuse = {
  kind: "component" | "look";
  name: string;
  file?: string;
  routes: string[];
  detail: string;
};

export type InspectFontRole = {
  role: "primary" | "secondary" | "tertiary";
  family: string;
  weight: string;
  size: string;
  usage: string;
  source: string;
};

export type InspectSwatch = {
  name: string;
  value: string;
  usage: string;
};

export type InspectButtonStyle = {
  role: "primary" | "secondary" | "tertiary";
  label: string;
  radius: string;
  fill: string;
  fillCss: string;
  text: string;
  padding: string;
  example: string;
  className: string;
};

export type InspectOverview = {
  fonts: InspectFontRole[];
  palette: InspectSwatch[];
  buttons: InspectButtonStyle[];
  summary: string;
};

export type InspectReport = {
  pages: InspectPage[];
  targets: InspectTarget[];
  tokens: InspectToken[];
  attention: InspectNote[];
  overview: InspectOverview;
  reuse: InspectReuse[];
};
