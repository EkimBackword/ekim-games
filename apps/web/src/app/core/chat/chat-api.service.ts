import { HttpClient } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { chatHistoryResponseSchema, type ChatMessage } from 'contracts';

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private readonly http = inject(HttpClient);

  getMessages(): Observable<ChatMessage[]> {
    return this.http
      .get<unknown>('/api/chat/messages')
      .pipe(map((response) => chatHistoryResponseSchema.parse(response)));
  }
}
