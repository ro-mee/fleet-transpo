import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../lib/theme-context";
import { fonts } from "../../lib/theme";
import cargoDemoFixtures from "../../lib/cargo-demo-fixtures";

const INITIAL_SCENARIO = "wait-and-recount";
const { getCargoDemoPresentation, listCargoDemoScenarios } = cargoDemoFixtures;
const scenarios = listCargoDemoScenarios();

function toneColors(colors, tone) {
  if (tone === "success") return { background: colors.primaryContainer, foreground: colors.onPrimaryContainer };
  if (tone === "danger") return { background: colors.errorContainer, foreground: colors.onErrorContainer };
  if (tone === "warning") return { background: colors.secondaryContainer, foreground: colors.onSecondaryContainer };
  return { background: colors.surfaceContainerHigh, foreground: colors.onSurface };
}

function formatUnit(unit, value) {
  if (unit === "box") return value === "1" ? "box" : "boxes";
  return value === "1" ? unit : `${unit}s`;
}

function CountCell({ label, value, unit, colors }) {
  return (
    <View style={[styles.countCell, { backgroundColor: colors.surfaceContainerLow }]}>
      <Text style={[styles.countLabel, { color: colors.onSurfaceVariant }]}>{label}</Text>
      <Text style={[styles.countValue, { color: colors.onSurface }]}>{value ?? "—"}</Text>
      <Text style={[styles.countUnit, { color: colors.onSurfaceVariant }]}>{unit && value !== null ? formatUnit(unit, value) : ""}</Text>
    </View>
  );
}

export default function CargoDemoScreen({ onBack }) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const [scenarioId, setScenarioId] = useState(INITIAL_SCENARIO);
  const [stepIndex, setStepIndex] = useState(0);
  const presentation = getCargoDemoPresentation(scenarioId, stepIndex);
  const status = presentation ? toneColors(colors, presentation.statusTone) : toneColors(colors, "info");

  const selectScenario = id => {
    setScenarioId(id);
    setStepIndex(0);
  };

  return (
    <ScrollView
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28, backgroundColor: colors.background },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <Pressable
        onPress={onBack}
        accessibilityRole="link"
        accessibilityLabel="Back to sign in"
        style={styles.backButton}
      >
        <Text style={[styles.backArrow, { color: colors.primary }]} aria-hidden="true">‹</Text>
        <Text style={[styles.backLabel, { color: colors.primary }]}>Back to sign in</Text>
      </Pressable>

      <View style={styles.intro}>
        <Text style={[styles.eyebrow, { color: colors.primary }]}>FLEETOPS  /  CARGO</Text>
        <Text style={[styles.pageTitle, { color: colors.onBackground }]}>Explore the cargo flow</Text>
        <Text style={[styles.introBody, { color: colors.onSurfaceVariant }]}>
          Restaurant and hotel trips share one driver workflow. The service, boxes and locations change with each trip.
        </Text>
      </View>

      <View
        accessibilityRole="summary"
        accessibilityLabel="Demo only. Simulated data. No real trip or order will change."
        style={[styles.demoNotice, { backgroundColor: colors.secondaryContainer, borderLeftColor: colors.secondary }]}
      >
        <Text style={[styles.noticeEyebrow, { color: colors.onSecondaryContainer }]}>DEMO ONLY · SIMULATED DATA</Text>
        <Text style={[styles.noticeTitle, { color: colors.onSecondaryContainer }]}>No real trip or order will change</Text>
        <Text style={[styles.noticeBody, { color: colors.onSecondaryContainer }]}>These examples stay on this screen. No request is sent and no cargo record is saved.</Text>
      </View>

      <View style={styles.selectorSection}>
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}>SAMPLE CASES</Text>
          <Text style={[styles.caseCount, { color: colors.outline }]}>{scenarios.length} examples</Text>
        </View>
        <View style={styles.caseGrid}>
          {scenarios.map((scenario, index) => {
            const selected = scenario.id === scenarioId;
            return (
              <Pressable
                key={scenario.id}
                onPress={() => selectScenario(scenario.id)}
                accessibilityRole="button"
                accessibilityLabel={`${scenario.shortLabel}, ${scenario.serviceLabel}${selected ? ", selected" : ""}`}
                accessibilityState={{ selected }}
                style={({ pressed }) => [
                  styles.caseButton,
                  {
                    backgroundColor: selected ? colors.primaryContainer : colors.surfaceContainerLow,
                    borderColor: selected ? colors.primary : colors.outlineVariant,
                    opacity: pressed ? 0.82 : 1,
                  },
                ]}
              >
                <Text style={[styles.caseIndex, { color: selected ? colors.primary : colors.outline }]}>
                  {String(index + 1).padStart(2, "0")}
                </Text>
                <Text style={[styles.caseTitle, { color: selected ? colors.onPrimaryContainer : colors.onSurface }]}>{scenario.shortLabel}</Text>
                <Text style={[styles.caseService, { color: selected ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>{scenario.serviceLabel}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {presentation ? (
        <View style={[styles.detailCard, { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant }]}>
          <View style={styles.detailHeader}>
            <View style={styles.detailTitleGroup}>
              <Text style={[styles.eyebrow, { color: colors.primary }]}>{presentation.serviceLabel.toUpperCase()}</Text>
              <Text style={[styles.detailTitle, { color: colors.onSurface }]}>{presentation.title}</Text>
            </View>
            <View style={[styles.statusPill, { backgroundColor: status.background }]}>
              <Text accessibilityLabel={`Sample status: ${presentation.statusLabel}`} style={[styles.statusText, { color: status.foreground }]}>{presentation.statusLabel}</Text>
            </View>
          </View>

          {presentation.stepCount > 1 ? (
            <View style={styles.timelineSection}>
              <Text style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}>SAMPLE TIMELINE</Text>
              <View style={styles.timelineButtons}>
                {scenarios.find(item => item.id === scenarioId) && ["Waiting for source", "After recount"].map((label, index) => {
                  const active = stepIndex === index;
                  return (
                    <Pressable
                      key={label}
                      onPress={() => setStepIndex(index)}
                      accessibilityRole="button"
                      accessibilityLabel={`${label}${active ? ", selected" : ""}`}
                      accessibilityState={{ selected: active }}
                      style={[styles.timelineButton, { borderColor: active ? colors.primary : colors.outlineVariant, backgroundColor: active ? colors.primaryContainer : colors.background }]}
                    >
                      <Text style={[styles.timelineButtonText, { color: active ? colors.onPrimaryContainer : colors.onSurfaceVariant }]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          <View style={[styles.summaryBlock, { borderLeftColor: colors.primary }]}>
            <Text style={[styles.summaryText, { color: colors.onSurface }]}>{presentation.summary}</Text>
          </View>

          {presentation.quantities ? (
            <View style={styles.quantitiesSection}>
              <Text style={[styles.sectionTitle, { color: colors.onSurfaceVariant }]}>BOX COUNT · SIMULATED</Text>
              <View style={styles.countsRow}>
                <CountCell label="Expected" value={presentation.quantities.expected} unit={presentation.quantities.unit} colors={colors} />
                <CountCell label="Picked up" value={presentation.quantities.pickedUp} unit={presentation.quantities.unit} colors={colors} />
                <CountCell label="Delivered" value={presentation.quantities.delivered} unit={presentation.quantities.unit} colors={colors} />
              </View>
              {presentation.quantities.pickedUp !== null ? (
                <View style={[styles.shortageRow, { borderTopColor: colors.outlineVariant }]}>
                  <View style={styles.shortageLine}>
                    <Text style={[styles.shortageLabel, { color: colors.onSurfaceVariant }]}>Order shortage</Text>
                    <Text style={[styles.shortageValue, { color: presentation.quantities.orderShortage === "0" ? colors.onSurface : colors.warning }]}>{presentation.quantities.orderShortage} {formatUnit(presentation.quantities.unit, presentation.quantities.orderShortage)}</Text>
                  </View>
                  {presentation.quantities.delivered !== null ? (
                    <View style={styles.shortageLine}>
                      <Text style={[styles.shortageLabel, { color: colors.onSurfaceVariant }]}>Delivery shortage</Text>
                      <Text style={[styles.shortageValue, { color: presentation.quantities.deliveryShortage === "0" ? colors.onSurface : colors.warning }]}>{presentation.quantities.deliveryShortage} {formatUnit(presentation.quantities.unit, presentation.quantities.deliveryShortage)}</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : (
            <View style={[styles.passengerNote, { backgroundColor: colors.surfaceContainer }]}>
              <Text style={[styles.passengerTitle, { color: colors.onSurface }]}>Guest and VIP stay in the passenger flow</Text>
              <Text style={[styles.passengerBody, { color: colors.onSurfaceVariant }]}>They do not use cargo box counts or shortage decisions.</Text>
            </View>
          )}

          <Text style={[styles.footerNote, { color: colors.outline }]}>SAMPLE {String(scenarios.findIndex(item => item.id === scenarioId) + 1).padStart(2, "0")} / {String(scenarios.length).padStart(2, "0")} · READ ONLY</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { flexGrow: 1, paddingHorizontal: 18, gap: 20 },
  backButton: { minHeight: 48, alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 4 },
  backArrow: { fontSize: 28, lineHeight: 30, fontFamily: fonts.body },
  backLabel: { fontSize: 14, lineHeight: 20, fontFamily: fonts.bodySemiBold },
  intro: { gap: 8 },
  eyebrow: { fontSize: 10, lineHeight: 14, letterSpacing: 1.1, fontFamily: fonts.dataSemiBold },
  pageTitle: { fontSize: 27, lineHeight: 34, letterSpacing: -0.6, fontFamily: fonts.displayBold },
  introBody: { maxWidth: 520, fontSize: 14, lineHeight: 21, fontFamily: fonts.body },
  demoNotice: { borderLeftWidth: 4, borderRadius: 16, paddingVertical: 16, paddingHorizontal: 16, gap: 6 },
  noticeEyebrow: { fontSize: 10, lineHeight: 14, letterSpacing: 1, fontFamily: fonts.dataSemiBold },
  noticeTitle: { fontSize: 16, lineHeight: 22, fontFamily: fonts.bodySemiBold },
  noticeBody: { fontSize: 13, lineHeight: 19, fontFamily: fonts.body },
  selectorSection: { gap: 10 },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { fontSize: 10, lineHeight: 14, letterSpacing: 0.9, fontFamily: fonts.dataSemiBold },
  caseCount: { fontSize: 11, lineHeight: 16, fontFamily: fonts.data },
  caseGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  caseButton: { flexGrow: 1, flexBasis: "47%", minWidth: 132, minHeight: 78, padding: 11, borderWidth: 1, borderRadius: 15, justifyContent: "center", gap: 3 },
  caseIndex: { fontSize: 9, lineHeight: 12, letterSpacing: 0.8, fontFamily: fonts.dataSemiBold },
  caseTitle: { fontSize: 13, lineHeight: 17, fontFamily: fonts.bodySemiBold },
  caseService: { fontSize: 10, lineHeight: 14, fontFamily: fonts.body },
  detailCard: { padding: 15, borderWidth: 1, borderRadius: 22, gap: 16 },
  detailHeader: { gap: 10 },
  detailTitleGroup: { gap: 5 },
  detailTitle: { fontSize: 20, lineHeight: 26, letterSpacing: -0.3, fontFamily: fonts.displaySemiBold },
  statusPill: { alignSelf: "flex-start", borderRadius: 999, paddingHorizontal: 11, paddingVertical: 7 },
  statusText: { fontSize: 11, lineHeight: 15, fontFamily: fonts.bodySemiBold },
  timelineSection: { gap: 8 },
  timelineButtons: { flexDirection: "row", gap: 8 },
  timelineButton: { flex: 1, minHeight: 48, paddingHorizontal: 10, borderWidth: 1, borderRadius: 14, justifyContent: "center", alignItems: "center" },
  timelineButtonText: { fontSize: 12, lineHeight: 16, textAlign: "center", fontFamily: fonts.bodySemiBold },
  summaryBlock: { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 2 },
  summaryText: { fontSize: 13, lineHeight: 20, fontFamily: fonts.body },
  quantitiesSection: { gap: 9 },
  countsRow: { flexDirection: "row", gap: 7 },
  countCell: { flex: 1, minWidth: 0, minHeight: 92, borderRadius: 14, paddingVertical: 10, paddingHorizontal: 8, justifyContent: "space-between" },
  countLabel: { fontSize: 10, lineHeight: 14, fontFamily: fonts.bodyMedium },
  countValue: { fontSize: 21, lineHeight: 26, fontFamily: fonts.dataSemiBold },
  countUnit: { fontSize: 10, lineHeight: 14, fontFamily: fonts.body },
  shortageRow: { paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth },
  shortageLine: { minHeight: 30, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  shortageLabel: { flexShrink: 1, fontSize: 12, lineHeight: 17, fontFamily: fonts.body },
  shortageValue: { fontSize: 12, lineHeight: 17, fontFamily: fonts.dataSemiBold },
  passengerNote: { borderRadius: 14, padding: 13, gap: 5 },
  passengerTitle: { fontSize: 13, lineHeight: 19, fontFamily: fonts.bodySemiBold },
  passengerBody: { fontSize: 12, lineHeight: 18, fontFamily: fonts.body },
  footerNote: { alignSelf: "flex-end", fontSize: 9, lineHeight: 13, letterSpacing: 0.7, fontFamily: fonts.dataSemiBold },
});
