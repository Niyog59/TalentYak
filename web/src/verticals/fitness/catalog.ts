import type { Vertical, Service } from "@/lib/catalog/types";

export const fitnessVertical: Vertical = {
  slug: "fitness",
  name: "Fitness Coaching",
  nameNe: "तन्दुरुस्ती",
  tagline: "Coaching that fits your kitchen — dal bhat included.",
  description:
    "Personal training and nutrition coaching from certified Nepali coaches, built around the food you actually eat and the schedule you actually keep. Async check-ins, form review, and plans that survive a Nepali kitchen.",
  status: "coming_soon",
  sort: 2,
};

export const fitnessServices: Service[] = [
  {
    id: "fitness-plan",
    verticalSlug: "fitness",
    name: "Plan",
    summary:
      "A custom training program or diet plan, delivered in about five days with one revision included.",
    description:
      "A one-time custom plan: training program or diet plan built for your goal, equipment, and kitchen. Delivered in about five days with one revision. Both plans together for $79.",
    priceCents: 4900,
    currency: "usd",
    billingType: "one_time",
    priceNote: "one-time · $79 for training + diet",
    status: "coming_soon",
    sort: 1,
  },
  {
    id: "fitness-coached",
    verticalSlug: "fitness",
    name: "Coached",
    summary:
      "Ongoing coaching from a coach you choose, on their own plan.",
    description:
      "Ongoing coaching. Each coach publishes their own plans: what is included, and the price. Compare coaches and read exactly what a plan includes before you pay. The price you sign up at stays the same for as long as you stay on that plan.",
    priceCents: 9900,
    currency: "usd",
    billingType: "subscription",
    billingInterval: "month",
    priceNote: "coaches set their own monthly price",
    status: "coming_soon",
    sort: 2,
  },
  {
    id: "fitness-premium",
    verticalSlug: "fitness",
    name: "Premium",
    summary:
      "Everything in Coached plus two live video sessions per month and priority responses.",
    description:
      "Coached, plus two live video calls with your coach each month and priority response times. Limited to about five clients per coach so the attention stays real.",
    priceCents: 15900,
    currency: "usd",
    billingType: "subscription",
    billingInterval: "month",
    priceNote: "/month · limited slots",
    status: "coming_soon",
    sort: 3,
  },
];
