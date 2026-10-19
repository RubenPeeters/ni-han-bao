"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Laptop, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

const ThemeSwitcher = () => {
  const [mounted, setMounted] = useState(false);
  const { theme } = useTheme();

  // useEffect only runs on the client, so now we can safely show the UI
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const ICON_SIZE = 16;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size={"sm"} aria-label="Theme">
          {theme === "light" ? (
            <Sun
              key="light"
              size={ICON_SIZE}
              className={"text-muted-foreground"}
            />
          ) : theme === "dark" ? (
            <Moon
              key="dark"
              size={ICON_SIZE}
              className={"text-muted-foreground"}
            />
          ) : (
            <Laptop
              key="system"
              size={ICON_SIZE}
              className={"text-muted-foreground"}
            />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-content" align="start">
        <ThemeRadioGroup />
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/** Light, dark or system; shared by this switcher and the account menu. */
function ThemeRadioGroup() {
  const { theme, setTheme } = useTheme();
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
      <DropdownMenuRadioItem className="flex gap-2" value="light">
        <Sun size={16} className="text-muted-foreground" /> <span>Light</span>
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem className="flex gap-2" value="dark">
        <Moon size={16} className="text-muted-foreground" /> <span>Dark</span>
      </DropdownMenuRadioItem>
      <DropdownMenuRadioItem className="flex gap-2" value="system">
        <Laptop size={16} className="text-muted-foreground" /> <span>System</span>
      </DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  );
}

export { ThemeRadioGroup, ThemeSwitcher };
