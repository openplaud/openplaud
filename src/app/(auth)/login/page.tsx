import { LoginForm } from "@/components/auth/login-form";
import { redirectIfAuthenticated } from "@/lib/auth-server";
import { env } from "@/lib/env";

export default async function LoginPage() {
    // Redirect to dashboard if already authenticated
    await redirectIfAuthenticated();

    return (
        <div className="flex min-h-screen items-center justify-center p-4">
            <div className="w-full max-w-md">
                <LoginForm registrationEnabled={!env.DISABLE_REGISTRATION} />
            </div>
        </div>
    );
}
