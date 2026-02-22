import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const DEFAULT_BASE_URL = "http://localhost:8000/v1";

// GET - List all models available in the Speaches registry
export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        const url = new URL(request.url);
        const baseUrl = url.searchParams.get("baseUrl") || DEFAULT_BASE_URL;

        const response = await fetch(
            `${baseUrl}/registry?task=automatic-speech-recognition`,
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
