import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map } from 'rxjs';
import {
  chatBeforeSchema,
  chatHistoryResponseSchema,
  chatPositionSchema,
  chatRecoveryResponseSchema,
  reconcileChatResponseSchema,
} from 'contracts';

const MESSAGES_URL = '/api/chat/messages';

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private readonly http = inject(HttpClient);

  getMessages(before?: string) {
    return this.http
      .get<unknown>(MESSAGES_URL, {
        observe: 'response',
        params: before ? { before } : {},
      })
      .pipe(
        map((response) => {
          const previous = response.headers.get('x-chat-before');
          return {
            messages: chatHistoryResponseSchema.parse(response.body),
            before: previous ? chatBeforeSchema.parse(previous) : null,
            position: before
              ? null
              : chatPositionSchema.parse(
                  response.headers.get('x-chat-position'),
                ),
          };
        }),
      );
  }

  recover(after: string, through?: string) {
    return this.http
      .get<unknown>(`${MESSAGES_URL}/recovery`, {
        params: through === undefined ? { after } : { after, through },
      })
      .pipe(map((response) => chatRecoveryResponseSchema.parse(response)));
  }

  reconcile(clientMessageIds: string[]) {
    return this.http
      .post<unknown>(`${MESSAGES_URL}/reconcile`, { clientMessageIds })
      .pipe(map((response) => reconcileChatResponseSchema.parse(response)));
  }
}
