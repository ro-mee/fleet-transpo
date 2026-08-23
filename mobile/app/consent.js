import { moderateScale } from '../lib/scaling';
import { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  Pressable
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
import { fonts, radius, space } from "../lib/theme";
import { Button, ErrorNotice, styles as ui } from "../components/ui";
import { BrandBar } from "../components/logo";
import { MaterialIcons } from "@expo/vector-icons";

function ConsentCard({ icon, title, description }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.cardItem, { backgroundColor: colors.surfaceContainer, borderColor: colors.outlineVariant }]}>
      <View style={[styles.iconBox, { backgroundColor: colors.primaryContainer }]}>
        <MaterialIcons name={icon} size={24} color={colors.onPrimaryContainer} />
      </View>
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: colors.onSurface }]}>{title}</Text>
        <Text style={[ui.bodyText, { color: colors.onSurfaceVariant, fontSize: 13 }]}>{description}</Text>
      </View>
    </View>
  );
}

export default function ConsentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const { colors } = useTheme();

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
      
      // Navigate to the permissions screen instead of the dashboard
      router.replace("/permissions");
    } catch (e) {
      setError(e.message || "Could not record your consent. Try again.");
    } finally {
      setSubmitting(false);
    }
  }, [router]);

  return (
    <View style={[styles.flex, { backgroundColor: colors.background }]}>
      <BrandBar />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + space.xxl + 80 },
        ]}
      >
        <View style={styles.header}>
          <View style={[styles.shieldContainer, { backgroundColor: colors.primaryContainer }]}>
            <MaterialIcons name="security" size={48} color={colors.onPrimaryContainer} />
          </View>
          <Text style={[styles.title, { color: colors.onSurface }]}>Driver Data Privacy</Text>
          <Text style={[styles.subtitle, { color: colors.onSurfaceVariant }]}>
            To keep operations running smoothly and securely, here is how we use your data.
          </Text>
        </View>

        <ErrorNotice message={error} />

        <View style={styles.cards}>
          <ConsentCard
            icon="location-on"
            title="Location Tracking"
            description="GPS is tracked while you are signed in and on duty, including periodic location checks between trips."
          />
          <ConsentCard
            icon="directions-car"
            title="Telematics & Vehicle Data"
            description="We monitor vehicle health and trip telemetry for safety."
          />
          <ConsentCard
            icon="update"
            title="Data Retention"
            description="Your tracking records are kept for 90 days for compliance."
          />
        </View>

        <Pressable 
          style={[styles.checkboxContainer, { borderColor: checked ? colors.primary : colors.outlineVariant }]} 
          onPress={() => setChecked(!checked)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked }}
        >
          <View style={[styles.checkbox, { 
            borderColor: checked ? colors.primary : colors.outline,
            backgroundColor: checked ? colors.primary : 'transparent' 
          }]}>
            {checked && <MaterialIcons name="check" size={16} color={colors.onPrimary} />}
          </View>
          <Text style={[styles.checkboxLabel, { color: colors.onSurface }]}>
            I agree to the Terms and Conditions and Privacy Policy
          </Text>
        </Pressable>
      </ScrollView>

      {/* Sticky Bottom Bar */}
      <View style={[styles.stickyFooter, { 
        backgroundColor: colors.surface, 
        borderTopColor: colors.outlineVariant,
        paddingBottom: Math.max(insets.bottom, space.md)
      }]}>
        <Button
          label="Confirm & Continue"
          onPress={onAccept}
          loading={submitting}
          disabled={!checked}
          style={styles.fullButton}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { 
    paddingHorizontal: space.xl, 
    paddingTop: space.xl, 
    gap: space.xl, 
    width: "100%", 
    maxWidth: moderateScale(720), 
    alignSelf: "center" 
  },
  header: { alignItems: "center", gap: space.sm, marginTop: space.md },
  shieldContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.sm,
  },
  title: {
    fontFamily: fonts.displaySemiBold,
    fontSize: moderateScale(24),
    textAlign: "center",
  },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: moderateScale(14),
    textAlign: "center",
    paddingHorizontal: space.md,
  },
  cards: { gap: space.md },
  cardItem: {
    flexDirection: "row",
    padding: space.md,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: space.md,
    alignItems: "center"
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(15) },
  checkboxContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: space.md,
    borderRadius: radius.control,
    borderWidth: 1,
    gap: space.md,
    marginTop: space.sm
  },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxLabel: {
    flex: 1,
    fontFamily: fonts.bodyMedium,
    fontSize: moderateScale(14),
  },
  stickyFooter: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    borderTopWidth: 1,
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
  },
  fullButton: { width: "100%" }
});