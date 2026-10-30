import { Monitor, Moon, Sun } from "lucide-react";
import { type ThemePreference, useThemePreference } from "../themePreference";
import { Button } from "../ui/button";
import { MenuContent, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuTrigger } from "../ui/radix";

const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
];

export function ThemeMenu() {
  const [theme, setTheme] = useThemePreference();
  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[0];
  const Icon = current?.Icon ?? Monitor;

  return (
    <MenuRoot>
      <MenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Theme: ${current?.label}`}>
          <Icon />
        </Button>
      </MenuTrigger>
      <MenuContent>
        <MenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
          {OPTIONS.map(({ value, label, Icon: ItemIcon }) => (
            <MenuRadioItem key={value} value={value}>
              <ItemIcon className="size-4" aria-hidden />
              {label}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </MenuRoot>
  );
}
