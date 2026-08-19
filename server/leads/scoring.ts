export type LeadScoreInput = {
  categoryCode?: string | null;
  website?: string | null;
  publicEmail?: string | null;
  phone?: string | null;
  verificationState?: "verified" | "partially_verified" | "unverified" | "conflicting" | "unavailable";
  hasBookingSignal?: boolean;
  hasSocialSignal?: boolean;
  hasEcommerceSignal?: boolean;
};

export type ScoreComponent = {
  componentKey: string;
  points: number;
  reasonCode: string;
  explanation: string;
};

export function scoreLead(input: LeadScoreInput) {
  const components: ScoreComponent[] = [];
  const category = input.categoryCode ?? "general";

  if (!input.website) {
    components.push({
      componentKey: "digital_gap",
      points: 32,
      reasonCode: "NO_WEBSITE_DETECTED",
      explanation: "No business website was supplied or detected, indicating a potential website opportunity.",
    });
  } else if (!input.hasBookingSignal && category === "restaurants") {
    components.push({
      componentKey: "booking_gap",
      points: 20,
      reasonCode: "NO_BOOKING_SIGNAL",
      explanation: "A restaurant website is present but no booking signal has been detected.",
    });
  } else if (!input.hasEcommerceSignal && category === "real-estate") {
    components.push({
      componentKey: "listing_gap",
      points: 18,
      reasonCode: "NO_LISTING_SIGNAL",
      explanation: "A real-estate business presence is available but no online listing or enquiry signal has been detected.",
    });
  }

  if (input.publicEmail) {
    components.push({
      componentKey: "contactability",
      points: 18,
      reasonCode: "PUBLIC_EMAIL_AVAILABLE",
      explanation: "A public business email is available for legitimate outreach evaluation.",
    });
  }

  if (input.phone) {
    components.push({
      componentKey: "contactability",
      points: 12,
      reasonCode: "PHONE_AVAILABLE",
      explanation: "A business phone number is available.",
    });
  }

  if (input.hasSocialSignal) {
    components.push({
      componentKey: "activity",
      points: 12,
      reasonCode: "SOCIAL_ACTIVITY_SIGNAL",
      explanation: "A public social-presence signal suggests an active business presence.",
    });
  }

  if (input.verificationState === "verified") {
    components.push({
      componentKey: "data_quality",
      points: 16,
      reasonCode: "VERIFIED_CONTACT",
      explanation: "At least one high-confidence contact field is verified.",
    });
  } else if (input.verificationState === "partially_verified") {
    components.push({
      componentKey: "data_quality",
      points: 9,
      reasonCode: "PARTIALLY_VERIFIED_CONTACT",
      explanation: "Contact information has partial verification support.",
    });
  }

  const totalScore = Math.min(100, components.reduce((total, component) => total + component.points, 0));
  return { totalScore, components };
}
