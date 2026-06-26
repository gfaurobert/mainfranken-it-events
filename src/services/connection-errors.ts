export class ConnectionOtpRequestRateLimitedError extends Error {
  constructor() {
    super("Please wait before requesting another connection code");
    this.name = "ConnectionOtpRequestRateLimitedError";
  }
}

export class ConnectionOtpRedeemRateLimitedError extends Error {
  constructor() {
    super("Too many failed code attempts. Please wait a minute and try again.");
    this.name = "ConnectionOtpRedeemRateLimitedError";
  }
}

export class InvalidConnectionOtpError extends Error {
  constructor() {
    super("Code not found or already used.");
    this.name = "InvalidConnectionOtpError";
  }
}

export class ExpiredConnectionOtpError extends Error {
  constructor() {
    super("Code expired. Ask your friend to generate a new one.");
    this.name = "ExpiredConnectionOtpError";
  }
}

export class SelfConnectionError extends Error {
  constructor() {
    super("You cannot connect with yourself.");
    this.name = "SelfConnectionError";
  }
}

export class RedeemOwnOtpError extends Error {
  constructor() {
    super("You cannot redeem your own code.");
    this.name = "RedeemOwnOtpError";
  }
}

export class ConnectionNameNotFoundError extends Error {
  constructor(name: string) {
    super(`No connected user matching '${name}'.`);
    this.name = "ConnectionNameNotFoundError";
  }
}

export class ConnectionNotFoundError extends Error {
  constructor() {
    super("You are not connected with this user.");
    this.name = "ConnectionNotFoundError";
  }
}
