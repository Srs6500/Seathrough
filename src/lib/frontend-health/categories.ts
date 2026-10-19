/** The six Frontend Health check categories (product contract). */
export const FRONTEND_HEALTH_CATEGORIES = [
  {
    id: "buttons_interactions",
    label: "Buttons and interactions",
    example: "Submit button crashes when clicked",
  },
  {
    id: "forms",
    label: "Forms",
    example: "Invalid email accepted or required fields ignored",
  },
  {
    id: "navigation",
    label: "Navigation",
    example: "Link leads to a 404 page",
  },
  {
    id: "runtime_errors",
    label: "Runtime errors",
    example: "Component throws an exception",
  },
  {
    id: "responsive_layouts",
    label: "Responsive layouts",
    example: "Mobile menu off-screen",
  },
  {
    id: "accessibility",
    label: "Accessibility",
    example: "Input lacks a label",
  },
] as const;

export type FrontendHealthCategoryId =
  (typeof FRONTEND_HEALTH_CATEGORIES)[number]["id"];
