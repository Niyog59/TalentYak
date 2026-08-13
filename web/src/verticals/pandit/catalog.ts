import type { Vertical, Service } from "@/lib/catalog/types";

export const panditVertical: Vertical = {
  slug: "pandit",
  name: "Ceremonies & Rites",
  nameNe: "कर्मकाण्ड",
  tagline: "Shraddha and ancestral rites, performed at Kathmandu temples on your behalf.",
  description:
    "We arrange qualified pandits at Gokarna and Pashupatinath for shraddha, tarpan, and related rites — following your family's tradition, on the correct tithi. You join by video from anywhere; the recording is always yours, free.",
  status: "active",
  sort: 1,
};

export const panditServices: Service[] = [
  {
    id: "shraddha-basic",
    verticalSlug: "pandit",
    name: "Annual Shraddha — Basic",
    summary:
      "Tarpan and pinda daan performed on your ancestor's tithi. Live video, recording included, tithi stored for annual reminders.",
    description:
      "A qualified pandit performs tarpan and pinda daan at Gokarna on the correct lunar tithi for your ancestor. You and your family join live by video. We store the tithi and remind you each year — you will never miss the date. Recording is always included, free.",
    priceCents: 14900,
    currency: "usd",
    billingType: "one_time",
    priceNote: "per ceremony · +$49 each additional ancestor",
    status: "active",
    sort: 1,
  },
  {
    id: "gokarna-shraddha-full",
    verticalSlug: "pandit",
    name: "Gokarna Shraddha — Full",
    summary:
      "90-minute ceremony with senior pandit and assistant, full samagri, photographs, live video, and recording.",
    description:
      "The complete shraddha at Gokarna: a senior pandit with assistant, all samagri arranged, a 90-minute ceremony conducted in your family's tradition. Live video for the family abroad, photographs and recording delivered afterward.",
    priceCents: 29900,
    currency: "usd",
    billingType: "one_time",
    priceNote: "per ceremony",
    status: "active",
    sort: 2,
  },
  {
    id: "gokarna-shraddha-complete",
    verticalSlug: "pandit",
    name: "Gokarna Shraddha — Complete",
    summary:
      "The full ceremony plus sida daan and brahmin bhojan, with priority scheduling on your tithi.",
    description:
      "Everything in the Full ceremony, extended with sida daan and brahmin bhojan arranged in your family's name, and priority scheduling on the exact tithi during busy periods.",
    priceCents: 49900,
    currency: "usd",
    billingType: "one_time",
    priceNote: "per ceremony",
    status: "active",
    sort: 3,
  },
  {
    id: "sohra-shraddha-bundle",
    verticalSlug: "pandit",
    name: "Sohra Shraddha — 16-day Bundle",
    summary:
      "Daily tarpan through all of Pitru Paksha, performed on your behalf with regular photo and video updates.",
    description:
      "During Pitru Paksha, tarpan is offered daily for sixteen days in your ancestors' names. We send updates through the fortnight and a full record at the end. Seasonal — capacity is limited and reserved in order of booking.",
    priceCents: 39900,
    currency: "usd",
    billingType: "one_time",
    priceNote: "seasonal · limited capacity",
    status: "active",
    sort: 4,
  },
  {
    id: "tripindi-pitru-dosh",
    verticalSlug: "pandit",
    name: "Tripindi Shraddha / Pitru Dosh",
    summary:
      "Extended rite with two pandits for ancestral appeasement, arranged with full samagri.",
    description:
      "An extended ritual conducted by two pandits for tripindi shraddha or pitru dosh nivaran, with all samagri and arrangements handled. We confirm the appropriate date and tradition with you before scheduling.",
    priceCents: 34900,
    currency: "usd",
    billingType: "one_time",
    priceNote: "per ceremony",
    status: "active",
    sort: 5,
  },
  {
    id: "rudrabhishek-pashupatinath",
    verticalSlug: "pandit",
    name: "Rudrabhishek at Pashupatinath",
    summary:
      "Rudrabhishek performed at Pashupatinath in your name, with live video and recording.",
    description:
      "Rudrabhishek conducted at Pashupatinath temple in your family's name — temple fees, pandit, and samagri all arranged. Join live by video; the recording is yours.",
    priceCents: 12900,
    currency: "usd",
    billingType: "one_time",
    priceNote: "per ceremony",
    status: "active",
    sort: 6,
  },
  {
    id: "kundali-pdf",
    verticalSlug: "pandit",
    name: "Kundali (Birth Chart)",
    summary:
      "A traditional Bikram Sambat kundali prepared by a jyotish, delivered as a PDF.",
    description:
      "A complete kundali prepared by an experienced jyotish using the Bikram Sambat calendar, delivered as a clean PDF — for newborns, marriages, or replacing a lost family chart.",
    priceCents: 4900,
    currency: "usd",
    billingType: "one_time",
    priceNote: "delivered in 5 days",
    status: "active",
    sort: 7,
  },
  {
    id: "muhurat-selection",
    verticalSlug: "pandit",
    name: "Muhurat Selection",
    summary:
      "An auspicious date and time selected by a jyotish for your ceremony, travel, or new beginning.",
    description:
      "A jyotish selects the correct muhurat for your occasion — griha pravesh, business opening, travel, or ceremony — with a short written explanation of the reasoning. Often added to a ceremony booking.",
    priceCents: 3900,
    currency: "usd",
    billingType: "one_time",
    priceNote: "add-on friendly",
    status: "active",
    sort: 8,
  },
];
