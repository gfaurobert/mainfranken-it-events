export function canonicalConnectionPair(userIdA: string, userIdB: string) {
  return userIdA < userIdB
    ? { user_a: userIdA, user_b: userIdB }
    : { user_a: userIdB, user_b: userIdA };
}

export function otherConnectionUserId(
  viewerId: string,
  userA: string,
  userB: string,
): string {
  return userA === viewerId ? userB : userA;
}
