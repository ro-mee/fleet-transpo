import { useRouter } from "expo-router";
import CargoDemoScreen from "../components/cargo/CargoDemoScreen";

export default function CargoDemoRoute() {
  const router = useRouter();
  return <CargoDemoScreen onBack={() => router.replace("/login")} />;
}
