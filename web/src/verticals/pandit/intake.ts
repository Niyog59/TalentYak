import type { IntakeSchema, IntakeField } from "@/lib/catalog/types";

/**
 * Intake forms for pandit services. Rendered by the generic form
 * renderer; responses stored on the booking and interpreted here
 * (tithi DB rows are created from these answers in the admin panel).
 */

const traditionField: IntakeField = {
  key: "tradition",
  label: "Family tradition",
  type: "select",
  required: true,
  options: [
    { value: "khas", label: "Khas / Parbatiya (Bahun-Chhetri)" },
    { value: "newar", label: "Newar" },
    { value: "other", label: "Other / not sure — we will call you" },
  ],
  help: "Ritual details differ by tradition. If unsure, choose 'not sure' and our senior pandit will confirm with you.",
};

const shraddhaFields: IntakeField[] = [
  {
    key: "deceased_name",
    label: "Name of the deceased",
    type: "text",
    required: true,
  },
  {
    key: "relation",
    label: "Your relation to them",
    type: "select",
    required: true,
    options: [
      { value: "father", label: "Father" },
      { value: "mother", label: "Mother" },
      { value: "grandfather", label: "Grandfather" },
      { value: "grandmother", label: "Grandmother" },
      { value: "other", label: "Other" },
    ],
  },
  { key: "gotra", label: "Gotra", type: "text", required: false, help: "Leave blank if you don't know — we can work with the pandit to determine it." },
  traditionField,
  {
    key: "tithi_known",
    label: "Do you know the tithi (lunar date) of passing?",
    type: "radio",
    required: true,
    options: [
      { value: "yes", label: "Yes — I know the tithi" },
      { value: "approximate", label: "I know the English (Gregorian) date of passing" },
      { value: "no", label: "No — please help me determine it" },
    ],
  },
  {
    key: "tithi_details",
    label: "Tithi or date of passing",
    type: "text",
    required: false,
    placeholder: "e.g. Ashwin Krishna Dwitiya — or 2019-10-03",
    help: "Whatever you know. We confirm the exact tithi with the pandit before scheduling.",
  },
  {
    key: "additional_ancestors",
    label: "Additional ancestors to include (+$49 each)",
    type: "number",
    required: false,
    placeholder: "0",
  },
  {
    key: "notes",
    label: "Anything else we should know",
    type: "textarea",
    required: false,
    placeholder: "Specific requests, family customs, timing constraints…",
  },
];

const kundaliFields: IntakeField[] = [
  { key: "person_name", label: "Full name", type: "text", required: true },
  { key: "date_of_birth", label: "Date of birth (AD)", type: "date", required: true },
  {
    key: "time_of_birth",
    label: "Time of birth",
    type: "text",
    required: true,
    placeholder: "e.g. 06:45 AM — as exact as possible",
  },
  {
    key: "place_of_birth",
    label: "Place of birth",
    type: "text",
    required: true,
    placeholder: "City / district, country",
  },
  {
    key: "gender",
    label: "Gender",
    type: "select",
    required: true,
    options: [
      { value: "male", label: "Male" },
      { value: "female", label: "Female" },
      { value: "other", label: "Other" },
    ],
  },
  { key: "notes", label: "Anything else", type: "textarea", required: false },
];

const muhuratFields: IntakeField[] = [
  {
    key: "occasion",
    label: "Occasion",
    type: "select",
    required: true,
    options: [
      { value: "griha_pravesh", label: "Griha pravesh (new home)" },
      { value: "business", label: "Business opening" },
      { value: "travel", label: "Travel" },
      { value: "ceremony", label: "Ceremony" },
      { value: "other", label: "Other" },
    ],
  },
  {
    key: "target_window",
    label: "Rough time window you're hoping for",
    type: "text",
    required: true,
    placeholder: "e.g. late November 2026, any weekend",
  },
  {
    key: "birth_details",
    label: "Birth details (optional, improves accuracy)",
    type: "textarea",
    required: false,
    placeholder: "Name, date, time, and place of birth of the main person",
  },
];

const rudrabhishekFields: IntakeField[] = [
  {
    key: "sankalpa_name",
    label: "Name for the sankalpa (dedication)",
    type: "text",
    required: true,
  },
  { key: "gotra", label: "Gotra", type: "text", required: false },
  {
    key: "occasion",
    label: "Occasion",
    type: "select",
    required: false,
    options: [
      { value: "birthday", label: "Birthday" },
      { value: "health", label: "Health / wellbeing" },
      { value: "shivaratri", label: "Shivaratri" },
      { value: "general", label: "General blessing" },
    ],
  },
  {
    key: "preferred_date",
    label: "Preferred date",
    type: "date",
    required: false,
    help: "We confirm availability at Pashupatinath before scheduling.",
  },
  { key: "notes", label: "Anything else", type: "textarea", required: false },
];

export const panditIntakeSchemas: IntakeSchema[] = [
  { serviceId: "shraddha-basic", version: 1, fields: shraddhaFields },
  { serviceId: "gokarna-shraddha-full", version: 1, fields: shraddhaFields },
  { serviceId: "gokarna-shraddha-complete", version: 1, fields: shraddhaFields },
  { serviceId: "sohra-shraddha-bundle", version: 1, fields: shraddhaFields },
  { serviceId: "tripindi-pitru-dosh", version: 1, fields: shraddhaFields },
  { serviceId: "rudrabhishek-pashupatinath", version: 1, fields: rudrabhishekFields },
  { serviceId: "kundali-pdf", version: 1, fields: kundaliFields },
  { serviceId: "muhurat-selection", version: 1, fields: muhuratFields },
];
