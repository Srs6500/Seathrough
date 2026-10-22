import type { SlrLesson } from "@/lib/voice-tutor/schemas";

/**
 * Canonical Lesson 001 — Understanding Functions / vertical-line test.
 * Hand-authored SLR seed (not LLM-generated).
 */
export const FUNCTIONS_LESSON: SlrLesson = {
  id: "functions-vertical-line-test",
  version: "1.0",
  title: "Understanding Functions",
  subject: "Mathematics",
  objective:
    "Explain why a relation is a function only when each input has exactly one output, and use the vertical-line test on a graph.",
  blocks: [
    {
      id: "function.relation_basics",
      type: "concept",
      title: "Inputs, outputs, and relations",
      prerequisites: [],
      relations: [
        { type: "part_of", target: "function.unique_output" },
      ],
      sourceRefs: [
        {
          sourceId: "seed_functions_v1",
          passageId: "passage_relation",
          title: "Relations and mappings",
          text: "A relation pairs inputs from a domain with outputs in a range. Thinking of a vending machine: you press a button (input) and receive a snack (output).",
          highlight: "pairs inputs from a domain with outputs",
        },
      ],
      lesson: {
        formalStatement:
          "A relation pairs each chosen input with one or more outputs.",
        keyPoints: [
          "An input is a value you start with (like x).",
          "An output is the result you get (like y).",
          "A relation is any pairing between inputs and outputs.",
        ],
        narration:
          "Before we talk about functions, remember that a relation just pairs inputs with outputs — like choosing a button on a vending machine.",
        socraticPrompts: [
          "In your own words, what is an input and what is an output?",
        ],
      },
    },
    {
      id: "function.unique_output",
      type: "concept",
      title: "Unique output condition",
      prerequisites: ["function.relation_basics"],
      relations: [
        { type: "applied_by", target: "function.vertical_line_test" },
      ],
      sourceRefs: [
        {
          sourceId: "seed_functions_v1",
          passageId: "passage_unique",
          title: "Definition of a function",
          text: "A function is a special relation in which each input from the domain is paired with exactly one output. Different inputs may share the same output, but one input cannot produce two different outputs.",
          highlight: "each input from the domain is paired with exactly one output",
        },
      ],
      lesson: {
        formalStatement: "Each input maps to exactly one output.",
        keyPoints: [
          "Every input in the domain has one output.",
          "Different inputs may have the same output.",
          "One input cannot correspond to multiple outputs in the same function.",
        ],
        narration:
          "A function is stricter than a plain relation. Each input is allowed exactly one output — never two at once.",
        socraticPrompts: [
          "Can one input produce two different outputs in a function? Why or why not?",
        ],
      },
      assessment: {
        rubricId: "unique_output_check",
        expectKeywords: ["one", "exactly", "single", "unique", "not two", "only one"],
        successSay:
          "Yes — in a function, each input gets exactly one output. Different inputs can still share an output.",
        hintSay:
          "Focus on one input. How many outputs is that input allowed to have if this is a function?",
      },
    },
    {
      id: "function.vertical_line_test",
      type: "concept",
      title: "Vertical-line test",
      prerequisites: ["function.unique_output"],
      relations: [
        { type: "applied_by", target: "function.apply_classify" },
      ],
      sourceRefs: [
        {
          sourceId: "seed_functions_v1",
          passageId: "passage_vlt",
          title: "Graphical test for functions",
          text: "On a graph, a relation is a function if and only if no vertical line intersects the graph more than once. A vertical line marks one input value; multiple intersections would mean multiple outputs for that input.",
          highlight: "no vertical line intersects the graph more than once",
        },
      ],
      lesson: {
        formalStatement:
          "A graph represents a function iff every vertical line meets it at most once.",
        keyPoints: [
          "A vertical line fixes one input value (one x).",
          "Count how many times that line hits the graph.",
          "Two or more hits means that input has multiple outputs — not a function.",
        ],
        narration:
          "The vertical-line test turns the unique-output rule into something you can see. One vertical line is one input — it should hit the graph at most once.",
        socraticPrompts: [
          "Look at the circle. What happens when the vertical line is at x equals zero?",
        ],
      },
      visual: {
        sceneId: "circle_graph",
        focusObjectIds: ["circle_1", "vertical_line_x0"],
      },
      assessment: {
        rubricId: "vertical_line_test_v1",
        expectKeywords: [
          "twice",
          "two",
          "two times",
          "more than once",
          "not a function",
          "two outputs",
          "two y",
        ],
        successSay:
          "Exactly. At x equals zero the line hits the circle twice, so that input would have two outputs — the circle is not the graph of a function.",
        hintSay:
          "Count the intersection points where the vertical line meets the circle. How many are there?",
      },
    },
    {
      id: "function.apply_classify",
      type: "assessment",
      title: "Apply: classify a graph",
      prerequisites: ["function.vertical_line_test"],
      relations: [],
      sourceRefs: [],
      lesson: {
        formalStatement:
          "Use the vertical-line test to decide whether a graph represents a function.",
        keyPoints: [
          "Pick a vertical line at a suspicious input.",
          "If it hits more than once, the graph is not a function.",
          "Say both the observation and the conclusion.",
        ],
        narration:
          "Now try a different graph — a sideways parabola. Decide whether it represents a function, and say why.",
        socraticPrompts: [
          "Does this sideways parabola pass the vertical-line test? Explain.",
        ],
      },
      visual: {
        sceneId: "sideways_parabola",
        focusObjectIds: ["parabola_1", "vertical_line_x2"],
      },
      assessment: {
        rubricId: "apply_classify_v1",
        expectKeywords: [
          "not a function",
          "fails",
          "twice",
          "two",
          "more than once",
          "two outputs",
        ],
        successSay:
          "Right — a vertical line can hit the sideways parabola twice, so it is not a function.",
        hintSay:
          "Imagine a vertical line through the open part of the sideways parabola. How many times does it cross?",
      },
    },
  ],
  scenes: [
    {
      sceneId: "circle_graph",
      title: "Circle vs vertical line",
      coordinateSystem: "cartesian",
      objects: [
        {
          id: "x_axis",
          type: "axis",
          params: { axis: "x", min: -4, max: 4 },
        },
        {
          id: "y_axis",
          type: "axis",
          params: { axis: "y", min: -4, max: 4 },
        },
        {
          id: "circle_1",
          type: "circle",
          params: { cx: 0, cy: 0, r: 3 },
        },
        {
          id: "vertical_line_x0",
          type: "line",
          params: { x1: 0, y1: -4, x2: 0, y2: 4 },
        },
        {
          id: "label_x0",
          type: "label",
          params: { x: 0.35, y: -3.4, text: "x = 0" },
        },
      ],
      traceTask: {
        targetId: "circle_1",
        interaction: "inspect",
        prompt: "Trace or inspect where the vertical line meets the circle.",
      },
    },
    {
      sceneId: "sideways_parabola",
      title: "Sideways parabola",
      coordinateSystem: "cartesian",
      objects: [
        {
          id: "x_axis",
          type: "axis",
          params: { axis: "x", min: -1, max: 5 },
        },
        {
          id: "y_axis",
          type: "axis",
          params: { axis: "y", min: -4, max: 4 },
        },
        {
          id: "parabola_1",
          type: "curve",
          params: {
            kind: "sideways_parabola",
            a: 0.35,
            vertexX: 0,
            vertexY: 0,
            yMin: -3.2,
            yMax: 3.2,
          },
        },
        {
          id: "vertical_line_x2",
          type: "line",
          params: { x1: 2, y1: -4, x2: 2, y2: 4 },
        },
        {
          id: "label_x2",
          type: "label",
          params: { x: 2.25, y: -3.4, text: "x = 2" },
        },
      ],
      traceTask: {
        targetId: "parabola_1",
        interaction: "inspect",
        prompt: "Check how many times the vertical line meets the curve.",
      },
    },
  ],
  steps: [
    {
      id: "s1_intro",
      blockId: "function.relation_basics",
      phase: "introduce",
      speech:
        "Today we'll nail down what makes a relation a function — the unique-output rule, then how to see it on a graph.",
      display: [{ type: "clear" }],
      expectResponse: "none",
    },
    {
      id: "s2_relation_source",
      blockId: "function.relation_basics",
      phase: "explain",
      speech:
        "A relation pairs inputs from a domain with outputs. Think of a vending machine — you press a button, and you get a snack.",
      display: [
        {
          type: "show_source",
          sourceId: "seed_functions_v1",
          passageId: "passage_relation",
        },
        {
          type: "highlight_source",
          passageId: "passage_relation",
          highlight: "pairs inputs from a domain with outputs",
        },
        { type: "show_keypoints", blockId: "function.relation_basics" },
      ],
      expectResponse: "none",
    },
    {
      id: "s3_unique_rule",
      blockId: "function.unique_output",
      phase: "explain",
      speech:
        "A function is a special relation: each input maps to exactly one output. Different inputs may share an output, but one input cannot produce two different outputs.",
      display: [
        {
          type: "show_source",
          sourceId: "seed_functions_v1",
          passageId: "passage_unique",
        },
        {
          type: "highlight_source",
          passageId: "passage_unique",
          highlight:
            "each input from the domain is paired with exactly one output",
        },
        { type: "show_keypoints", blockId: "function.unique_output" },
      ],
      expectResponse: "none",
    },
    {
      id: "s4_unique_ask",
      blockId: "function.unique_output",
      phase: "guide",
      speech:
        "Quick check — can one input produce two different outputs in a function? Say it in your own words.",
      display: [
        {
          type: "ask",
          prompt:
            "Can one input produce two different outputs in a function? Why or why not?",
        },
      ],
      expectResponse: "spoken_reasoning",
    },
    {
      id: "s5_vlt_intro",
      blockId: "function.vertical_line_test",
      phase: "explain",
      speech:
        "On a graph, we use the vertical-line test. A vertical line marks one input. If it hits the graph more than once, that input would have multiple outputs — so the graph is not a function.",
      display: [
        {
          type: "show_source",
          sourceId: "seed_functions_v1",
          passageId: "passage_vlt",
        },
        {
          type: "highlight_source",
          passageId: "passage_vlt",
          highlight: "no vertical line intersects the graph more than once",
        },
        { type: "show_keypoints", blockId: "function.vertical_line_test" },
      ],
      expectResponse: "none",
    },
    {
      id: "s6_circle_demo",
      blockId: "function.vertical_line_test",
      phase: "demonstrate",
      speech:
        "Here is a circle. Notice the vertical line at x equals zero. Trace or look carefully at where it meets the circle.",
      display: [
        { type: "show_scene", sceneId: "circle_graph" },
        {
          type: "focus_objects",
          sceneId: "circle_graph",
          objectIds: ["circle_1", "vertical_line_x0"],
        },
        {
          type: "trace_start",
          sceneId: "circle_graph",
          targetId: "circle_1",
        },
      ],
      expectResponse: "none",
    },
    {
      id: "s7_circle_ask",
      blockId: "function.vertical_line_test",
      phase: "guide",
      speech:
        "Look at the circle. What happens when the vertical line is at x equals zero? How many outputs would that input have?",
      display: [
        { type: "show_scene", sceneId: "circle_graph" },
        {
          type: "focus_objects",
          sceneId: "circle_graph",
          objectIds: ["vertical_line_x0"],
        },
        {
          type: "ask",
          prompt:
            "At x = 0, how many times does the vertical line meet the circle — and is this a function?",
        },
      ],
      expectResponse: "spoken_reasoning",
    },
    {
      id: "s8_apply",
      blockId: "function.apply_classify",
      phase: "practice",
      speech:
        "Your turn. This sideways parabola opens to the right. Does it pass the vertical-line test? Explain your reasoning.",
      display: [
        { type: "show_scene", sceneId: "sideways_parabola" },
        {
          type: "focus_objects",
          sceneId: "sideways_parabola",
          objectIds: ["parabola_1", "vertical_line_x2"],
        },
        {
          type: "ask",
          prompt:
            "Does this sideways parabola represent a function? Why or why not?",
        },
      ],
      expectResponse: "spoken_reasoning",
    },
    {
      id: "s9_complete",
      blockId: "function.apply_classify",
      phase: "complete",
      speech:
        "Nice work. You connected the unique-output rule to the vertical-line test, and you classified a graph with reasons. Next time we can try graphs that do pass the test.",
      display: [{ type: "clear" }],
      expectResponse: "none",
    },
  ],
};
