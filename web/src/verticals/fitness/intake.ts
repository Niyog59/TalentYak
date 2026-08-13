import type { IntakeSchema, IntakeField } from "@/lib/catalog/types";

/**
 * Fitness intake quiz (handover §6): goal, coach preference, language,
 * equipment, injuries. The founder assigns a coach within 48 hours of
 * a paid booking; a free coach switch is always offered.
 */
const quizFields: IntakeField[] = [
  {
    key: "goal",
    label: "Main goal",
    type: "select",
    required: true,
    options: [
      { value: "fat_loss", label: "Lose fat" },
      { value: "muscle", label: "Build muscle" },
      { value: "general", label: "General fitness & energy" },
      { value: "sport", label: "Sport / performance" },
    ],
  },
  {
    key: "coach_gender",
    label: "Coach preference",
    type: "select",
    required: true,
    options: [
      { value: "any", label: "No preference" },
      { value: "male", label: "Male coach" },
      { value: "female", label: "Female coach" },
    ],
  },
  {
    key: "language",
    label: "Preferred coaching language",
    type: "select",
    required: true,
    options: [
      { value: "nepali", label: "Nepali" },
      { value: "english", label: "English" },
      { value: "either", label: "Either" },
    ],
  },
  {
    key: "equipment",
    label: "What do you have access to?",
    type: "checkbox",
    options: [
      { value: "gym", label: "Commercial gym" },
      { value: "dumbbells", label: "Dumbbells at home" },
      { value: "bands", label: "Resistance bands" },
      { value: "none", label: "Bodyweight only" },
    ],
  },
  {
    key: "schedule",
    label: "Days per week you can train",
    type: "select",
    required: true,
    options: [
      { value: "2", label: "2 days" },
      { value: "3", label: "3 days" },
      { value: "4", label: "4 days" },
      { value: "5+", label: "5 or more" },
    ],
  },
  {
    key: "timezone_city",
    label: "Your city & timezone",
    type: "text",
    required: true,
    placeholder: "e.g. Dallas, US Central",
  },
  {
    key: "diet_style",
    label: "How do you mostly eat?",
    type: "select",
    required: true,
    options: [
      { value: "nepali", label: "Nepali food at home (dal bhat etc.)" },
      { value: "mixed", label: "Mix of Nepali and Western" },
      { value: "western", label: "Mostly Western" },
      { value: "vegetarian", label: "Vegetarian" },
    ],
    help: "Your plan is built around your actual kitchen — that's the point.",
  },
  {
    key: "injuries",
    label: "Injuries or health conditions we should know about",
    type: "textarea",
    required: false,
    placeholder: "Knees, back, blood pressure, anything your coach should plan around",
  },
  {
    key: "notes",
    label: "Anything else for your coach",
    type: "textarea",
    required: false,
  },
];

export const fitnessIntakeSchemas: IntakeSchema[] = [
  { serviceId: "fitness-plan", version: 1, fields: quizFields },
  { serviceId: "fitness-coached", version: 1, fields: quizFields },
  { serviceId: "fitness-premium", version: 1, fields: quizFields },
];
