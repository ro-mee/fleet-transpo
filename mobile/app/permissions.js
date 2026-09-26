import { useCallback, useEffect, useState } from "react";
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
import { fonts } from "../lib/theme";
import { ErrorNotice } from "../components/ui";
import {
  describePermissionState,
  getPermissionStatuses,
  listAppPermissions,
  requestAppPermission,
  PERMISSION_STATUS,
} from "../lib/permissions";
import { registerDeviceToken } from "../lib/notifications/device-token";
import {
  OnboardingBackground,
  OnboardingButton,
  OnboardingCard,
  OnboardingHeader,
  onboardingTheme,
} from "../components/onboarding";

// 4 core permissions required by the onboarding spec
const ONBOARDING_PERMISSION_KEYS = [
  "location",
  "locationBackground",
  "camera",
  "mediaLibrary",
];

export default function PermissionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { height } = useWindowDimensions();
  const compact = height < 740;

  const permissions = listAppPermissions().filter((p) =>
    ONBOARDING_PERMISSION_KEYS.includes(p.key)
  );

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [statuses, setStatuses] = useState({});

  useEffect(() => {
    let active = true;
    getPermissionStatuses()
      .then((results) => {
        if (!active) return;
        setStatuses(Object.fromEntries(results.map((r) => [r.key, r])));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const onRequestSinglePermission = useCallback(async (key) => {
    try {
      const result = await requestAppPermission(key);
      if (result) {
        setStatuses((prev) => ({ ...prev, [key]: result }));
        if (key === "notifications" && result.status === PERMISSION_STATUS.GRANTED) {
          await registerDeviceToken().catch(() => {});
        }
      }
    } catch (e) {
      setError(e.message || "Could not request permission.");
    }
  }, []);

  const onRequestPermissions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allPermissions = listAppPermissions();
      for (const entry of allPermissions) {
        const result = await requestAppPermission(entry.key);
        if (result) {
          setStatuses((prev) => ({ ...prev, [entry.key]: result }));
          if (entry.key === "notifications" && result.status === PERMISSION_STATUS.GRANTED) {
            await registerDeviceToken().catch(() => {});
          }
        }
      }
      router.replace("/");
    } catch (e) {
      setError(e.message || "Something went wrong while requesting permissions.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  return (
    <OnboardingBackground showMapBg={true}>
      <OnboardingHeader step="2/2" compact={compact} />

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
            source={require("../assets/images/onboarding/permissions-hero.png")}
            style={[styles.heroImage, compact && styles.heroImageCompact]}
            resizeMode="contain"
          />
          <Text style={[styles.heroTitle, compact && styles.heroTitleCompact]}>
            <Text style={styles.heroTitleAccent}>App </Text>
            <Text style={styles.heroTitleMain}>Permissions</Text>
          </Text>
          <Text style={[styles.heroSubtitle, compact && styles.heroSubtitleCompact]}>
            We need a few permissions to give you the best experience on the road.
          </Text>
        </View>

        {error ? <ErrorNotice message={error} /> : null}

        {/* 4 Permission Cards */}
        <View style={[styles.cardsContainer, compact && styles.cardsContainerCompact]}>
          {permissions.map((entry) => {
            const state = statuses[entry.key];
            const presentation = describePermissionState(state);

            return (
              <OnboardingCard
                key={entry.key}
                icon={entry.icon}
                title={entry.title}
                description={entry.why}
                status={presentation}
                compact={compact}
                showChevron={false}
                onPress={() => onRequestSinglePermission(entry.key)}
              />
            );
          })}
        </View>
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
          label="Enable Permissions"
          onPress={onRequestPermissions}
          loading={loading}
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
    gap: 12,
    width: "100%",
    maxWidth: 680,
    alignSelf: "center",
  },
  scrollContentCompact: {
    paddingHorizontal: 14,
    paddingTop: 2,
    gap: 9,
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
  heroImage: {
    width: 136,
    height: 136,
    marginBottom: 8,
  },
  heroImageCompact: {
    width: 112,
    height: 112,
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
