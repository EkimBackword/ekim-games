import { Injectable } from '@angular/core';
import {
  distinctUntilChanged,
  fromEvent,
  map,
  merge,
  Observable,
  shareReplay,
  startWith,
} from 'rxjs';

@Injectable({ providedIn: 'root' })
export class NetworkStatusService {
  readonly isOnline$: Observable<boolean> = merge(
    fromEvent(window, 'online').pipe(map(() => true)),
    fromEvent(window, 'offline').pipe(map(() => false)),
  ).pipe(
    startWith(window.navigator.onLine),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true }),
  );
}
