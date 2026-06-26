export function formatServiceError(error: unknown): string {
  if (error instanceof Error && typeof error.message === "string" && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message) {
      return message;
    }
  }

  return "An unexpected error occurred";
}
