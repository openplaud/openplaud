import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { apiCredentials } from "@/db/schema";
import { auth } from "@/lib/auth";

const DEFAULT_BASE_URL = "http://localhost:8000/v1";

async function getBaseUrl(userId: string): Promise<string> {
    // Read the Speaches base URL from the user's stored credentials
    // instead of accepting it from the query string (SSRF prevention).
    const [speachesCredential] = await db
        .select({ baseUrl: apiCredentials.baseUrl })
        .from(apiCredentials)
        .where(
            and(
                eq(apiCredentials.userId, userId),
                eq(apiCredentials.provider, "Speaches"),
            ),
        )
        .limit(1);
    return speachesCredential?.baseUrl || DEFAULT_BASE_URL;
}

// GET - List installed ASR models
export async function GET(request: Request) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const baseUrl = await getBaseUrl(session.user.id);
        const response = await fetch(
            `${baseUrl}/models?task=automatic-speech-recognition`,
        );

        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to fetch models from Speaches" },
                { status: response.status },
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Error fetching Speaches models:", error);
        return NextResponse.json(
            { error: "Failed to connect to Speaches" },
            { status: 500 },
        );
    }
}

// POST - Install a model
export async function POST(request: Request) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const baseUrl = await getBaseUrl(session.user.id);
        const { modelId } = await request.json();

        if (!modelId) {
            return NextResponse.json(
                { error: "Model ID is required" },
                { status: 400 },
            );
        }

        const encodedModelId = encodeURIComponent(modelId);
        const response = await fetch(`${baseUrl}/models/${encodedModelId}`, {
            method: "POST",
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to install model" },
                { status: response.status },
            );
        }

        const data = await response.json();
        return NextResponse.json(data);
    } catch (error) {
        console.error("Error installing Speaches model:", error);
        return NextResponse.json(
            { error: "Failed to install model" },
            { status: 500 },
        );
    }
}

// DELETE - Remove a model
export async function DELETE(request: Request) {
    try {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session?.user) {
            return NextResponse.json(
                { error: "Unauthorized" },
                { status: 401 },
            );
        }

        const baseUrl = await getBaseUrl(session.user.id);
        const url = new URL(request.url);
        const modelId = url.searchParams.get("modelId");

        if (!modelId) {
            return NextResponse.json(
                { error: "Model ID is required" },
                { status: 400 },
            );
        }

        const encodedModelId = encodeURIComponent(modelId);
        const response = await fetch(`${baseUrl}/models/${encodedModelId}`, {
            method: "DELETE",
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: "Failed to remove model" },
                { status: response.status },
            );
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error("Error removing Speaches model:", error);
        return NextResponse.json(
            { error: "Failed to remove model" },
            { status: 500 },
        );
    }
}
