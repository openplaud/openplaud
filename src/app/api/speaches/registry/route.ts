import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
    SPEACHES_DEFAULT_BASE_URL,
    validateBaseUrl,
} from "@/lib/speaches/validate-url";

// GET - List all models available in the Speaches registry
export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const url = new URL(request.url);
        const baseUrl =
            url.searchParams.get("baseUrl") || SPEACHES_DEFAULT_BASE_URL;

        const urlValidation = validateBaseUrl(baseUrl);
        if (!urlValidation.valid) {
            return NextResponse.json(
                { error: urlValidation.error },
                { status: 400 },
            );
        }

        const response = await fetch(
            `${baseUrl.replace(/\/+$/, "")}/registry?task=automatic-speech-recognition`,
            { signal: AbortSignal.timeout(15000), redirect: "error" },
        );

        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to fetch registry from Speaches" },
                { status: response.status },
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Error fetching Speaches registry:", error);
        return NextResponse.json(
            { error: "Failed to connect to Speaches" },
            { status: 500 },
        );
    }
}
