import { ClayButton } from "../clay";
// Retain the shared Clay button, with enough room for native large-text wrapping.
export function CargoButton(props) {
  return <ClayButton {...props} style={[{ minHeight: 48, minWidth: 48, alignItems: "stretch" }, props.style]} textStyle={[{ flexShrink: 1, textAlign: "center" }, props.textStyle]} />;
}
