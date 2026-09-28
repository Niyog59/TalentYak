/** What a coach can mark as useful to track. Advice only; every field stays optional. */
export const FOCUS_LABEL: Record<string, string> = {
  workouts: "Logging your workouts",
  bodyweight: "Body weight",
  waist: "Waist",
  hips: "Hips",
  chest: "Chest",
  arm: "Arm",
  photos: "Progress photos",
  food_photos: "Food photos",
  food_notes: "Food notes",
  food_numbers: "Calories and protein, if you know them",
};

export type Meal = "breakfast" | "lunch" | "dinner" | "snack" | "other";
export const MEAL_LABEL: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack", other: "Other" };
