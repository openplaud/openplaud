"use client";

import {
    Keyboard,
    LogOut,
    Monitor,
    Moon,
    Settings,
    Shield,
    Sun,
    User,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "@/hooks/use-theme";
import { signOut } from "@/lib/auth-client";

interface UserMenuProps {
    isAdmin: boolean;
    initialTheme: "light" | "dark" | "system";
    onOpenSettings: () => void;
    onOpenShortcuts: () => void;
}

export function UserMenu({
    isAdmin,
    initialTheme,
    onOpenSettings,
    onOpenShortcuts,
}: UserMenuProps) {
    const router = useRouter();
    const { theme, setTheme } = useTheme(initialTheme);

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Account menu">
                    <User className="w-4 h-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Account</DropdownMenuLabel>
                <DropdownMenuItem onSelect={onOpenSettings}>
                    <Settings />
                    Settings
                    <DropdownMenuShortcut>,</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onOpenShortcuts}>
                    <Keyboard />
                    Keyboard shortcuts
                    <DropdownMenuShortcut>?</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                        {theme === "dark" ? (
                            <Moon />
                        ) : theme === "light" ? (
                            <Sun />
                        ) : (
                            <Monitor />
                        )}
                        Theme
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                        <DropdownMenuRadioGroup
                            value={theme}
                            onValueChange={(v) =>
                                setTheme(v as "light" | "dark" | "system")
                            }
                        >
                            <DropdownMenuRadioItem value="light">
                                <Sun className="mr-2 h-4 w-4" />
                                Light
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="dark">
                                <Moon className="mr-2 h-4 w-4" />
                                Dark
                            </DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="system">
                                <Monitor className="mr-2 h-4 w-4" />
                                System
                            </DropdownMenuRadioItem>
                        </DropdownMenuRadioGroup>
                    </DropdownMenuSubContent>
                </DropdownMenuSub>
                {isAdmin && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                            onSelect={() => router.push("/admin")}
                        >
                            <Shield />
                            Admin dashboard
                        </DropdownMenuItem>
                    </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    variant="destructive"
                    onSelect={async () => {
                        await signOut();
                        router.push("/");
                        router.refresh();
                    }}
                >
                    <LogOut />
                    Log out
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
