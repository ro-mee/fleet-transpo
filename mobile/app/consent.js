import { moderateScale } from '../lib/scaling';
import { useCallback, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api } from "../lib/api";
import {
  CURRENT_PRIVACY_POLICY_VERSION,
  setAcceptedConsentVersion,
} from "../lib/consent";
import { useTheme } from "../lib/theme-context";
import { fonts, space } from "../lib/theme";
import { ErrorNotice } from "../components/ui";
import { BrandBar } from "../components/logo";
import { MaterialIcons } from "@expo/vector-icons";
import { ClayCard, ClayButton, ClayTile } from "../components/clay";

function ConsentCard({ icon, title, description }) {
  const { colors, type } = useTheme();
  return (
    <ClayCard variant="compact" style={styles.cardItem}>
      <ClayTile
        size="md"
        backgroundColor={colors.primaryContainer}
      >
        <MaterialIcons name={icon} size={24} color={colors.onPrimaryContainer} />
      </ClayTile>
      <View style={styles.cardText}>
        <Text style={[styles.cardTitle, { color: colors.onSurface }]}>{title}</Text>
        <Text style={[type.caption, { color: colors.onSurfaceVariant, fontSize: 13, lineHeight: 18 }]}>{description}</Text>
      </View>
    </ClayCard>
  );
}

export default function ConsentScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
          <ClayTile
            size="lg"
            backgroundColor={colors.primaryContainer}
            style={styles.shieldTile}
          >
            <MaterialIcons name="security" size={38} color={colors.onPrimaryContainer} />
          </ClayTile>
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
            description="Your live location is tracked while you are on duty, so dispatch can route trips and keep them safe."
          />
          <ConsentCard
            icon="directions-car"
            title="Telematics & Vehicle Data"
            description="We collect fuel and vehicle activity associated with your trips, plus your license details and attendance records."
          />
          <ConsentCard
            icon="update"
            title="Data Retention"
            description="Records are kept for as long as you remain a driver and as required to meet legal and operational compliance obligations."
          />
        </View>

        <ClayCard 
          variant="compact"
          style={styles.checkboxContainer} 
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
        </ClayCard>
      </ScrollView>

      {/* Sticky Bottom Bar */}
      <View style={[styles.stickyFooter, { 
        backgroundColor: colors.surface, 
        borderTopColor: colors.outlineVariant,
        paddingBottom: Math.max(insets.bottom, space.md)
      }]}>
        <ClayButton
          label="Confirm & Continue"
          onPress={onAccept}
          loading={submitting}
          disabled={!checked}
          size="lg"
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
  shieldTile: {
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
    gap: space.md,
    alignItems: "center"
  },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { fontFamily: fonts.bodySemiBold, fontSize: moderateScale(15) },
  checkboxContainer: {
    flexDirection: "row",
    alignItems: "center",
    padding: space.md,
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