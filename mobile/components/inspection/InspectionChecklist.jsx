import React from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../lib/theme-context';
import { fonts, TOUCH_TARGET } from '../../lib/theme';
import { moderateScale } from '../../lib/scaling';
import { raisedControl } from '../../lib/clay';
import { ClayCard } from '../clay';
import { CoachMarkTarget } from '../coachmarks';
import { ReferencePhotoGuide } from '../ReferencePhotoGuide';
import { inspectionReferenceFor } from '../../lib/inspection-reference-images';

export default function InspectionChecklist({ items: CHECKLIST, answers: statuses, remarks, onAnswer: setStatus, onRemarks: setRemarks, isCargoPreTrip = false, screenMode = 'pretrip', scrollRef, handleCardLayout = () => {}, styles: providedStyles, raised: providedRaised }) {
  const { colors, type, scheme } = useTheme();
  const isDark = scheme === 'dark';
  const raised = providedRaised || raisedControl(isDark);
  const styles = providedStyles || defaultStyles;
  return <>
          {/* Checklist */}
          <View style={styles.checklist}>
            {CHECKLIST.map((item, idx) => {
              if (item.kind === "acknowledgment") {
                const isAcknowledged = statuses[item.id] === "PASS";
                const ackBg = isAcknowledged
                  ? (isDark ? "#1E5647" : colors.primary)
                  : colors.surfaceContainerHigh;
                const ackBorder = isAcknowledged
                  ? (isDark ? "#3E8D75" : colors.primary)
                  : (isDark ? "rgba(255,255,255,0.06)" : colors.outlineVariant + "50");
                const ackTextColor = isAcknowledged ? "#FFFFFF" : colors.onSurface;

                return (
                  <View
                    key={item.id}
                    onLayout={(e) => handleCardLayout(item.id, e)}
                  >
                    <ClayCard
                      variant="compact"
                      style={styles.checkItem}
                    >
                      <View style={styles.cardHeaderRow}>
                        <View
                          style={[
                            styles.categoryIconBadge,
                            {
                              backgroundColor: isAcknowledged
                                ? (isDark ? "rgba(46, 125, 50, 0.2)" : "#E8F5E9")
                                : (isDark ? colors.surfaceContainerHighest : colors.surfaceVariant),
                            },
                          ]}
                        >
                          <Ionicons
                            name={item.icon || "sparkles-outline"}
                            size={20}
                            color={isAcknowledged ? colors.primary : colors.onSurfaceVariant}
                          />
                        </View>
                        <View style={{ flex: 1, gap: 2 }}>
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                            <Text style={[styles.cardCategoryTitle, { color: colors.onSurface }]}>
                              {item.shortTitle || item.label}
                            </Text>
                            <Text style={[styles.cardSectionTag, { color: colors.primary }]}>
                              {item.section || "CABIN READY?"}
                            </Text>
                          </View>
                          <Text style={[styles.cardQuestionText, { color: isDark ? "#CBD5E1" : colors.onSurfaceVariant }]}>
                            {isCargoPreTrip ? "Clean, tidy, air conditioning working and no unpleasant odors." : "Before departure, make sure:"}
                          </Text>
                        </View>
                      </View>

                      {!isCargoPreTrip && <View style={styles.bulletList}>
                        {(item.reminders || []).map((reminder, rIdx) => (
                          <View key={rIdx} style={styles.bulletRow}>
                            <Text style={[styles.bulletPoint, { color: colors.primary }]}>•</Text>
                            <Text style={[type.bodyMd, styles.bulletText, { color: colors.onSurface }]}>
                              {reminder}
                            </Text>
                          </View>
                        ))}
                      </View>}
                      {item.supportingText && (
                        <Text style={[type.supporting, { color: colors.onSurfaceVariant, marginTop: 2, fontStyle: "italic" }]}>
                          {isCargoPreTrip ? "Prepare the cabin for safe cargo transport. Freshen it if needed." : item.supportingText}
                        </Text>
                      )}
                      <Pressable
                        onPress={() => setStatus(item.id, isAcknowledged ? null : "PASS")}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: isAcknowledged }}
                        style={({ pressed }) => [
                          styles.cabinAckBtn,
                          raised,
                          {
                            backgroundColor: ackBg,
                            borderColor: ackBorder,
                            transform: [{ scale: pressed ? 0.98 : 1 }],
                            opacity: pressed ? 0.9 : 1,
                          },
                        ]}
                      >
                        <Ionicons
                          name={isAcknowledged ? "checkmark-circle" : "checkmark-circle-outline"}
                          size={20}
                          color={isAcknowledged ? "#FFFFFF" : colors.primary}
                        />
                        <Text style={[styles.cabinAckBtnText, { color: ackTextColor }]} numberOfLines={1}>
                          {isCargoPreTrip ? isAcknowledged ? "PASS · CABIN READY" : "CONFIRM CABIN READY" : isAcknowledged ? "✓ CABIN VERIFIED & READY" : (item.buttonLabel || "✓ CABIN READY")}
                        </Text>
                      </Pressable>
                    </ClayCard>
                  </View>
                );
              }

              const status = statuses[item.id];
              const isPass = status === "PASS";
              const isFail = status === "FAIL";
              const isServiceFinding = item.findingTone === "service";
              const unselectedTextColor = isDark ? "#E2E8F0" : colors.onSurface;
              const unselectedIconColor = isDark ? "#94A3B8" : colors.onSurfaceVariant;

              const passBg = isPass
                ? (isDark ? "#1E5647" : colors.primary)
                : colors.surfaceContainerHigh;
              const passBorder = isPass
                ? (isDark ? "#3E8D75" : colors.primary)
                : (isDark ? "rgba(255,255,255,0.06)" : "transparent");
              const passTextColor = isPass ? "#FFFFFF" : unselectedTextColor;
              const passIconColor = isPass ? "#FFFFFF" : unselectedIconColor;

              const failBg = isFail
                ? (isServiceFinding
                  ? (isDark ? "rgba(217, 119, 6, 0.22)" : "#FEF3C7")
                  : colors.errorContainer)
                : colors.surfaceContainerHigh;
              const failBorder = isFail
                ? (isServiceFinding ? "#D97706" : colors.error)
                : (isDark ? "rgba(255,255,255,0.06)" : "transparent");
              const failTextColor = isFail
                ? (isServiceFinding
                  ? (isDark ? "#FDE68A" : "#92400E")
                  : colors.onErrorContainer)
                : unselectedTextColor;
              const failIconColor = isFail
                ? (isServiceFinding
                  ? (isDark ? "#FDE68A" : "#B45309")
                  : colors.onErrorContainer)
                : unselectedIconColor;
              const reference = isCargoPreTrip ? inspectionReferenceFor(item.id) : null;

              return (
                <View
                  key={item.id}
                  onLayout={(e) => handleCardLayout(item.id, e)}
                >
                  <ClayCard
                    variant="compact"
                    style={styles.checkItem}
                  >
                    <View style={styles.cardHeaderRow}>
                      <View
                        style={[
                          styles.categoryIconBadge,
                          {
                            backgroundColor: isPass
                              ? (isDark ? "rgba(46, 125, 50, 0.2)" : "#E8F5E9")
                              : isFail
                              ? (isServiceFinding
                                ? (isDark ? "rgba(217, 119, 6, 0.2)" : "#FEF3C7")
                                : (isDark ? "rgba(239, 68, 68, 0.2)" : "#FEE2E2"))
                              : (isDark ? colors.surfaceContainerHighest : colors.surfaceVariant),
                          },
                        ]}
                      >
                        <Ionicons
                          name={item.icon || "checkmark-circle-outline"}
                          size={20}
                          color={
                            isPass
                              ? colors.primary
                              : isFail
                              ? (isServiceFinding ? "#D97706" : colors.error)
                              : colors.onSurfaceVariant
                          }
                        />
                      </View>
                      <View style={{ flex: 1, gap: 2 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <Text style={[styles.cardCategoryTitle, { color: colors.onSurface }]}>
                            {screenMode === "preshift" ? `${idx + 1}. ${item.shortTitle || item.label}` : (item.shortTitle || item.label)}
                          </Text>
                          {item.section && (
                            <Text style={[styles.cardSectionTag, { color: isCargoPreTrip && isFail ? colors.error : colors.primary }]}>
                              {isCargoPreTrip ? status || "REQUIRED" : item.section}
                            </Text>
                          )}
                        </View>
                        <Text style={[styles.cardQuestionText, { color: isDark ? "#CBD5E1" : colors.onSurfaceVariant }]}>
                          {item.question}
                        </Text>
                      </View>
                    </View>

                    {isCargoPreTrip && (
                      <ReferencePhotoGuide
                        source={reference?.source}
                        subject={item.shortTitle || item.label}
                        caption={reference?.caption}
                      >
                        <Text style={[type.supporting, { color: colors.onSurfaceVariant }]}>
                          {item.id === "brakes_tires"
                            ? "Check the actual tires for visible damage and confirm the brakes work properly. Report any issue before departure."
                            : "Check the actual load and its straps or restraints. Report loose or unsecured cargo before departure."}
                        </Text>
                      </ReferencePhotoGuide>
                    )}

                    {idx === 0 ? (
                      <CoachMarkTarget id="inspection.pass_fail" targetId="inspection.pass_fail" radius={14} scrollRef={scrollRef}>
                        <View style={styles.checkBtnRow}>
                          {/* PASS button */}
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityLabel={`${item.label}: ${item.passLabel || "Pass"}`}
                            accessibilityState={{ checked: isPass }}
                            onPress={() => setStatus(item.id, "PASS")}
                            style={({ pressed }) => [
                              styles.checkBtn,
                              raised,
                              {
                                backgroundColor: passBg,
                                borderColor: passBorder,
                                transform: [{ scale: pressed ? 0.97 : 1 }],
                                opacity: pressed ? 0.9 : 1,
                              },
                            ]}
                          >
                            <Ionicons
                              name={isPass ? "checkmark-circle" : "checkmark-circle-outline"}
                              size={16}
                              color={passIconColor}
                            />
                            <Text
                              style={[
                                styles.checkBtnText,
                                { color: passTextColor },
                              ]}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.75}
                            >
                              {item.passLabel || "PASS"}
                            </Text>
                          </Pressable>

                          {/* FAIL button */}
                          <Pressable
                            accessibilityRole="radio"
                            accessibilityLabel={`${item.label}: ${item.failLabel || "Fail"}`}
                            accessibilityState={{ checked: isFail }}
                            onPress={() => setStatus(item.id, "FAIL")}
                            style={({ pressed }) => [
                              styles.checkBtn,
                              raised,
                              {
                                backgroundColor: failBg,
                                borderColor: failBorder,
                                transform: [{ scale: pressed ? 0.97 : 1 }],
                                opacity: pressed ? 0.9 : 1,
                              },
                            ]}
                          >
                            <Ionicons
                              name={item.failLabel === "WARNING" ? "warning-outline" : isFail ? (isServiceFinding ? "bag-outline" : "close-circle") : "close-circle-outline"}
                              size={16}
                              color={failIconColor}
                            />
                            <Text
                              style={[
                                styles.checkBtnText,
                                { color: failTextColor },
                              ]}
                              numberOfLines={1}
                              adjustsFontSizeToFit
                              minimumFontScale={0.75}
                            >
                              {item.failLabel || "FAIL"}
                            </Text>
                          </Pressable>
                        </View>
                      </CoachMarkTarget>
                    ) : (
                      <View style={styles.checkBtnRow}>
                        {/* PASS button */}
                        <Pressable
                          accessibilityRole="radio"
                          accessibilityLabel={`${item.label}: ${item.passLabel || "Pass"}`}
                          accessibilityState={{ checked: isPass }}
                          onPress={() => setStatus(item.id, "PASS")}
                          style={({ pressed }) => [
                            styles.checkBtn,
                            raised,
                            {
                              backgroundColor: passBg,
                              borderColor: passBorder,
                              transform: [{ scale: pressed ? 0.97 : 1 }],
                              opacity: pressed ? 0.9 : 1,
                            },
                          ]}
                        >
                          <Ionicons
                            name={isPass ? "checkmark-circle" : "checkmark-circle-outline"}
                            size={16}
                            color={passIconColor}
                          />
                          <Text
                            style={[
                              styles.checkBtnText,
                              { color: passTextColor },
                            ]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                          >
                            {item.passLabel || "PASS"}
                          </Text>
                        </Pressable>

                        {/* FAIL button */}
                        <Pressable
                          accessibilityRole="radio"
                          accessibilityLabel={`${item.label}: ${item.failLabel || "Fail"}`}
                          accessibilityState={{ checked: isFail }}
                          onPress={() => setStatus(item.id, "FAIL")}
                          style={({ pressed }) => [
                            styles.checkBtn,
                            raised,
                            {
                              backgroundColor: failBg,
                              borderColor: failBorder,
                              transform: [{ scale: pressed ? 0.97 : 1 }],
                              opacity: pressed ? 0.9 : 1,
                            },
                          ]}
                        >
                          <Ionicons
                            name={item.failLabel === "WARNING" ? "warning-outline" : isFail ? (isServiceFinding ? "bag-outline" : "close-circle") : "close-circle-outline"}
                            size={16}
                            color={failIconColor}
                          />
                          <Text
                            style={[
                              styles.checkBtnText,
                              { color: failTextColor },
                            ]}
                            numberOfLines={1}
                            adjustsFontSizeToFit
                            minimumFontScale={0.75}
                          >
                            {item.failLabel || "FAIL"}
                          </Text>
                        </Pressable>
                      </View>
                    )}

                    {/* Remarks input when failed */}
                    {isFail && (
                      <View style={{ gap: 6 }}>
                        <Text style={[type.labelMd, { color: colors.onSurface }]}>Issue remarks (required)</Text>
                        <CoachMarkTarget id="inspection.remarks" targetId="inspection.remarks" radius={12} scrollRef={scrollRef}>
                          <TextInput
                            accessibilityLabel={`${item.label}: issue remarks, required`}
                            accessibilityHint={item.remarksPrompt || "Describe the issue before saving."}
                            placeholder={item.remarksPrompt || "Describe issue..."}
                            placeholderTextColor={colors.outline}
                            value={remarks[item.id] || ""}
                            maxLength={1000}
                            onChangeText={(text) =>
                              setRemarks((prev) => ({ ...prev, [item.id]: text }))
                            }
                            style={[
                              styles.remarkInput,
                              {
                                borderColor: isServiceFinding ? "#D97706" : (colors.error + "60"),
                                color: colors.onSurface,
                                backgroundColor: colors.surfaceContainerLowest,
                              },
                            ]}
                            multiline
                          />
                        </CoachMarkTarget>
                        {isServiceFinding && (
                          <View style={styles.serviceFindingNoteRow}>
                            <Ionicons name="information-circle-outline" size={15} color="#D97706" />
                            <Text style={[type.caption, { color: isDark ? "#FDE68A" : "#92400E", flex: 1 }]}>
                              Service finding will be logged for dispatch & Lost & Found. You can still proceed with your route.
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </ClayCard>
                </View>
              );
            })}
          </View>

  </>;
}
const defaultStyles = StyleSheet.create({
bulletList: {
    gap: moderateScale(4),
    marginVertical: moderateScale(4),
  },
bulletPoint: {
    fontSize: moderateScale(16),
    lineHeight: moderateScale(20),
  },
bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(6),
  },
bulletText: {
    flex: 1,
    lineHeight: moderateScale(20),
  },
cabinAckBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    height: TOUCH_TARGET,
    borderRadius: moderateScale(10),
    borderWidth: 1,
    gap: moderateScale(8),
    marginTop: moderateScale(6),
    paddingHorizontal: moderateScale(12),
  },
cabinAckBtnText: {
    fontSize: moderateScale(13),
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 0.3,
  },
cardCategoryTitle: {
    fontSize: moderateScale(15),
    fontFamily: fonts.displayBold,
    letterSpacing: -0.2,
  },
cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: moderateScale(10),
    marginBottom: moderateScale(2),
  },
cardQuestionText: {
    fontSize: moderateScale(13.5),
    lineHeight: moderateScale(19),
    fontFamily: fonts.bodyMedium,
  },
cardSectionTag: {
    fontSize: moderateScale(10),
    textTransform: "uppercase",
    letterSpacing: 0.5,
    fontFamily: fonts.bodySemiBold,
  },
categoryIconBadge: {
    width: moderateScale(36),
    height: moderateScale(36),
    borderRadius: moderateScale(10),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.04)",
  },
checkBtn: {
    flex: 1,
    height: TOUCH_TARGET,
    borderRadius: moderateScale(8),
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: moderateScale(6),
    gap: moderateScale(5),
  },
checkBtnRow: { flexDirection: "row", gap: moderateScale(8) },
checkBtnText: {
    fontSize: moderateScale(11.5),
    fontFamily: fonts.bodySemiBold,
    letterSpacing: 0.1,
    textAlign: "center",
  },
checkItem: {
    borderRadius: moderateScale(12),
    padding: moderateScale(12),
    gap: moderateScale(10),
    shadowColor: "#000",
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
    minHeight: moderateScale(68),
    width: "100%",
  },
checklist: { gap: moderateScale(10), width: "100%" },
remarkInput: {
    borderWidth: 1,
    borderRadius: moderateScale(8),
    padding: moderateScale(10),
    minHeight: moderateScale(60),
    textAlignVertical: "top",
  },
serviceFindingNoteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: moderateScale(6),
    paddingHorizontal: moderateScale(4),
    marginTop: moderateScale(2),
  },
});
