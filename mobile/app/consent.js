import { useCallback, useState } from "react";
import {
  Image,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../lib/api";
import {
  CURRENT_PRIVACY_POLICY_VERSION,
  setAcceptedConsentVersion,
} from "../lib/consent";
import { fonts } from "../lib/theme";
import { ErrorNotice } from "../components/ui";
import {
  OnboardingBackground,
  OnboardingButton,
  OnboardingCard,
  OnboardingConsentRow,
  OnboardingHeader,
  onboardingTheme,
} from "../components/onboarding";

export default function ConsentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const compact = height < 740;

  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const onAccept = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.post("/api/driver/me/consent", {
        policy_version: CURRENT_PRIVACY_POLICY_VERSION,
        accepted: true,
        via: "mobile",
      });
      await setAcceptedConsentVersion(CURRENT_PRIVACY_POLICY_VERSION);

      // Navigate to the permissions screen
      router.replace("/permissions");
    } catch (e) {
      setError(e.message || "Could not record your consent. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [router]);

  return (
    <OnboardingBackground showMapBg={false}>
      <OnboardingHeader step="1/2" compact={compact} />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.scrollContent,
          compact && styles.scrollContentCompact,
          { paddingBottom: insets.bottom + 90 },
        ]}
      >
        {/* Centered Hero Section */}
        <View style={[styles.heroSection, compact && styles.heroSectionCompact]}>
          <Image
            source={require("../assets/images/onboarding/privacy-shield.png")}
            style={[styles.shieldImage, compact && styles.shieldImageCompact]}
            resizeMode="contain"
          />
          <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]}>
            <Text style={styles.heroTitleAccent}>Driver Data </Text>
            <Text style={styles.heroTitleMain}>Privacy</Text>
          </Text>
          <Text style={[styles.heroSubtitle, compact && styles.heroSubtitleCompact]}>
            To keep operations running smoothly and securely, here is how we use your data.
          </Text>
        </View>

        {error ? <ErrorNotice message={error} /> : null}

        {/* 3 Privacy Info Cards */}
        <View style={[styles.cardsContainer, compact && styles.cardsContainerCompact]}>
          <OnboardingCard
            icon="location"
            title="Location Tracking"
            description="Your live location is tracked while you are on duty, so dispatch can route trips and keep them safe."
            compact={compact}
            showChevron={true}
          />
          <OnboardingCard
            icon="car"
            title="Telematics & Vehicle Data"
            description="We collect fuel and vehicle activity associated with your trips, plus your license details and attendance records."
            compact={compact}
            showChevron={true}
          />
          <OnboardingCard
            icon="time"
            title="Data Retention"
            description="Records are kept for as long as you remain a driver and as required to meet legal and operational compliance obligations."
            compact={compact}
            showChevron={true}
          />
        </View>

        {/* Consent Row */}
        <OnboardingConsentRow
          checked={checked}
          onToggle={() => setChecked((prev) => !prev)}
          compact={compact}
          style={styles.consentRow}
        />
      </ScrollView>

      {/* Sticky Bottom CTA */}
      <View
        style={[
          styles.stickyFooter,
          compact && styles.stickyFooterCompact,
          { paddingBottom: Math.max(insets.bottom, 14) },
        ]}
      >
        <OnboardingButton
          label="Confirm & Continue"
          onPress={onAccept}
          disabled={!checked}
          loading={submitting}
          compact={compact}
        />
      </View>
    </OnboardingBackground>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    paddingHorizontal: 18,
    paddingTop: 4,
    gap: 11,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  scrollContentCompact: {
    paddingHorizontal: 14,
    paddingTop: 2,
    gap: 8,
  },
  heroSection: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    marginBottom: 6,
  },
  heroSectionCompact: {
    marginTop: 2,
    marginBottom: 4,
  },
  shieldImage: {
    width: 98,
    height: 98,
    marginBottom: 8,
  },
  shieldImageCompact: {
    width: 80,
    height: 80,
    marginBottom: 6,
  },
  heroTitle: {
    fontFamily: fonts.displayBold,
    fontSize: 27,
    lineHeight: 32,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  heroTitleCompact: {
    fontSize: 23,
    lineHeight: 27,
  },
  heroTitleAccent: {
    color: onboardingTheme.colors.mint,
  },
  heroTitleMain: {
    color: onboardingTheme.colors.textPrimary,
  },
  heroSubtitle: {
    fontFamily: fonts.body,
    fontSize: 13.5,
    lineHeight: 19,
    color: onboardingTheme.colors.textSecondary,
    textAlign: "center",
    marginTop: 5,
    paddingHorizontal: 16,
    maxWidth: 330,
  },
  heroSubtitleCompact: {
    fontSize: 12.5,
    lineHeight: 17,
    marginTop: 3,
    paddingHorizontal: 10,
    maxWidth: 300,
  },
  cardsContainer: {
    gap: 10,
  },
  cardsContainerCompact: {
    gap: 8,
  },
  consentRow: {
    marginTop: 2,
  },
  stickyFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: 18,
    paddingTop: 10,
    backgroundColor: "rgba(3, 27, 27, 0.96)",
    borderTopWidth: 1,
    borderTopColor: "rgba(120, 224, 210, 0.14)",
  },
  stickyFooterCompact: {
    paddingHorizontal: 14,
    paddingTop: 8,
  },
});