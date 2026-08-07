import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import {
  CURRENT_PRIVACY_POLICY_VERSION,
  setAcceptedConsentVersion,
} from "../lib/consent";
import { useTheme } from "../lib/theme-context";
import { fonts, space } from "../lib/theme";
import { Button, Card, ErrorNotice, ScreenTitle, styles as ui } from "../components/ui";
import { BrandBar } from "../components/logo";

/**
 * Driver consent gate for the app.
 *
 * Shown before the driver home whenever the signed-in driver has not accepted
 * the current privacy policy version. Acceptance is recorded server-side
 * (via:"mobile", POST /api/driver/me/consent) so it is traceable, and the
 * accepted version is cached locally through lib/consent so returning drivers
 * are not re-prompted. The demo driver has no backend, so it consents locally.
 */
export default function ConsentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();

  const [policy, setPolicy] = useState(null);
  const [loadingPolicy, setLoadingPolicy] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // The policy text is the same source the web reads — the /me response embeds
  // consent.policy — so the mobile wording never drifts from the web.
  const loadPolicy = useCallback(async () => {
    try {
      setError(null);
      const me = await api.get("/api/driver/me");
      setPolicy(me?.consent?.policy ?? null);
    } catch (e) {
      // Without a policy to show we still let consent proceed; the accept call
      // returns the full policy itself.
      setError(e.message || "Could not load the policy.");
    } finally {
      setLoadingPolicy(false);
    }
  }, []);

  useEffect(() => {
    loadPolicy();
  }, [loadPolicy]);

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
      // The layout guard now lets this driver through; head to the home screen.
      router.replace("/");
    } catch (e) {
      setError(e.message || "Could not record your consent. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [router, user]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl },
        ]}
      >
        <ScreenTitle
          eyebrow="Before you start"
          title="Driver data privacy & terms"
        />

        <ErrorNotice message={error} />

        {loadingPolicy && !policy ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <>
            <Card style={styles.policyCard}>
              {policy ? (
                <>
                  <Text style={[styles.versionLine, { color: colors.onSurfaceVariant }]}>
                    Version {policy.version} · Effective{" "}
                    {policy.effectiveDate ?? "Aug 5, 2026"}
                  </Text>
                  {policy.sections?.map((section) => (
                    <View key={section.heading} style={styles.section}>
                      <Text style={[styles.sectionHeading, { color: colors.onSurface }]}>{section.heading}</Text>
                      <Text style={[ui.bodyText, { color: colors.onSurfaceVariant }]}>{section.body}</Text>
                    </View>
                  ))}
                </>
              ) : (
                <Text style={[ui.bodyText, { color: colors.onSurfaceVariant }]}>
                  Before using the app, your acceptance of the organization's data
                  privacy policy is required. Your license scan, face photo, live
                  location while on duty, and trip activity are used for dispatch,
                  identity verification, and operational records only.
                </Text>
              )}
            </Card>

            <Text style={[styles.note, { color: colors.onSurfaceVariant }]}>
              You can review and correct your own information from your profile at
              any time.
            </Text>

            <Button
              label="I agree to the policy"
              onPress={onAccept}
              loading={submitting}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: space.xl, paddingTop: space.xl, gap: space.lg },
  policyCard: { gap: space.base },
  versionLine: {
    fontFamily: fonts.data,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  section: { gap: space.xs },
  sectionHeading: {
    fontFamily: fonts.display,
    fontSize: 16,
    lineHeight: 22,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 19,
  },
});