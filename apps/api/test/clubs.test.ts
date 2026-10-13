import { describe, expect, it } from "vitest";
import { api, fakePdf, signUp, upload } from "./helpers.js";

describe("book clubs", () => {
  it("creates a club, invites, shares progress and discusses", async () => {
    const owner = await signUp(undefined, "Owner");
    const friend = await signUp(undefined, "Friend");
    const stranger = await signUp();
    const book = (await upload(owner, "club.pdf", fakePdf(), { title: "Middlemarch", author: "George Eliot" })).json();

    const club = (await api(owner, "POST", "/api/clubs", { bookId: book.id, name: "Victorian novels", description: "One chapter a week" })).json();
    expect(club).toMatchObject({ name: "Victorian novels", isOwner: true, members: 1, book: { title: "Middlemarch" } });

    // Only members see it.
    expect((await api(stranger, "GET", `/api/clubs/${club.id}`)).statusCode).toBe(404);

    const preview = (await api(friend, "GET", `/api/clubs/invite/${club.inviteToken}`)).json();
    expect(preview).toMatchObject({ name: "Victorian novels", ownerName: "Owner", isMember: false, myBookId: null });
    const joined = (await api(friend, "POST", `/api/clubs/invite/${club.inviteToken}/join`)).json();
    expect(joined.clubId).toBe(club.id);
    // Joining put the book in the friend's library.
    const friendBooks = (await api(friend, "GET", "/api/books")).json();
    expect(friendBooks.map((b: { id: string }) => b.id)).toContain(joined.bookId);
    expect((await api(friend, "POST", `/api/clubs/invite/${club.inviteToken}/join`)).statusCode).toBe(200); // idempotent

    await api(friend, "PUT", `/api/books/${joined.bookId}/progress`, { locator: "page:10", percentage: 0.4, deviceId: "d", clientUpdatedAt: Date.now() });
    const detail = (await api(owner, "GET", `/api/clubs/${club.id}`)).json();
    expect(detail.members).toHaveLength(2);
    expect(detail.members[0]).toMatchObject({ name: "Friend", progress: expect.closeTo(0.4, 5) });
    expect(detail.members[1]).toMatchObject({ name: "Owner", isOwner: true, progress: null });

    expect((await api(friend, "POST", `/api/clubs/${club.id}/messages`, { text: "Dorothea!", quote: "Miss Brooke had that kind of beauty", locator: "pdf:1:0-10" })).statusCode).toBe(201);
    const msgs = (await api(owner, "GET", `/api/clubs/${club.id}`)).json().messages;
    expect(msgs[0]).toMatchObject({ author: "Friend", text: "Dorothea!", quote: "Miss Brooke had that kind of beauty", canDelete: true, isMine: false });
    expect((await api(stranger, "POST", `/api/clubs/${club.id}/messages`, { text: "hi" })).statusCode).toBe(404);

    // Clubs of a book, from inside the reader.
    expect((await api(friend, "GET", `/api/clubs?bookId=${joined.bookId}`)).json().map((c: { id: string }) => c.id)).toEqual([club.id]);

    // A new invite link stops the old one.
    const { inviteToken } = (await api(owner, "POST", `/api/clubs/${club.id}/invite/reset`)).json();
    expect((await api(stranger, "GET", `/api/clubs/invite/${club.inviteToken}`)).statusCode).toBe(404);
    expect((await api(friend, "POST", `/api/clubs/${club.id}/invite/reset`)).statusCode).toBe(403);
    expect(inviteToken).not.toBe(club.inviteToken);

    expect((await api(owner, "DELETE", `/api/clubs/${club.id}/members/me`)).statusCode).toBe(400); // owner deletes instead
    expect((await api(friend, "DELETE", `/api/clubs/${club.id}/members/me`)).statusCode).toBe(204);
    expect((await api(friend, "GET", `/api/clubs/${club.id}`)).statusCode).toBe(404);
    expect((await api(owner, "DELETE", `/api/clubs/${club.id}`)).statusCode).toBe(204);
    expect((await api(owner, "GET", "/api/clubs")).json()).toHaveLength(0);
  });
});
