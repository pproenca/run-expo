export function codexReviewOverlayComponentSource(): string {
  return `import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type CodexReviewOverlayProps = {
  endpoint?: string;
  screenName?: string;
  inspectedViewRef?: React.RefObject<unknown>;
};

export function CodexReviewOverlay({ endpoint = "http://127.0.0.1:17655/events", screenName = "Screen", inspectedViewRef }: CodexReviewOverlayProps): React.ReactElement {
  const [active, setActive] = useState(false);
  const [events, setEvents] = useState([]);
  const sequence = useRef(0);

  const submit = useCallback(async (event) => {
    const payload = {
      id: "overlay-" + Date.now().toString(36) + "-" + sequence.current++,
      screenName,
      createdAt: new Date().toISOString(),
      ...event,
    };
    setEvents((current) => current.concat(payload));
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch {}
  }, [endpoint, screenName]);

  const label = useMemo(() => active ? "Tap target" : "Comment", [active]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <View pointerEvents="box-none" style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Codex review comment"
          onPress={() => setActive((value) => !value)}
          style={[styles.button, active ? styles.active : null]}
        >
          <Text style={styles.buttonText}>{label}</Text>
        </Pressable>
      </View>
      {active ? (
        <Pressable
          accessibilityLabel="Codex review target surface"
          style={StyleSheet.absoluteFill}
          onPress={(event) => {
            const { locationX, locationY, pageX, pageY } = event.nativeEvent;
            submit({
              type: "tap-comment",
              gesture: { locationX, locationY, pageX, pageY },
              element: { refAvailable: Boolean(inspectedViewRef?.current) },
            });
            setActive(false);
          }}
        />
      ) : null}
      <View pointerEvents="none" style={styles.counter}>
        <Text style={styles.counterText}>{events.length}</Text>
      </View>
    </View>
  );
}

export default CodexReviewOverlay;

const styles = StyleSheet.create({
  toolbar: { position: "absolute", top: 48, right: 16, zIndex: 9999 },
  button: { backgroundColor: "#0a84ff", borderRadius: 18, paddingHorizontal: 14, paddingVertical: 9 },
  active: { backgroundColor: "#ff453a" },
  buttonText: { color: "white", fontWeight: "700" },
  counter: { position: "absolute", top: 92, right: 16, minWidth: 24, alignItems: "center" },
  counterText: { color: "white", backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 12, overflow: "hidden", paddingHorizontal: 7, paddingVertical: 2 },
});
`;
}
