import { addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase/config';

export async function appendAuditLog(
  teamId: string,
  actorUid: string,
  action: string,
  meta: Record<string, unknown> = {}
) {
  await addDoc(collection(db, 'teams', teamId, 'auditLogs'), {
    at: serverTimestamp(),
    actorUid,
    action,
    meta,
  });
}
