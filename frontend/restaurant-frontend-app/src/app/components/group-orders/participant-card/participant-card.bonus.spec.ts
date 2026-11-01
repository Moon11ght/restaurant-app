import { TestBed } from '@angular/core/testing';

import { Participant } from '@app/models/group-orders/participant.model';
import { ParticipantCardComponent } from './participant-card.component';

const GUEST: Participant = {
  id: 'guest-session-1',
  type: 'Guest',
  name: 'Alex',
  items: [],
  total: 0,
  isSubmitted: false,
};

const OWNER: Participant = {
  id: 'owner-session',
  type: 'Owner',
  name: 'Yevhenii',
  items: [],
  total: 0,
  isSubmitted: true,
};

describe('ParticipantCardComponent guest removal bonus', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ParticipantCardComponent] }));

  function render(participant: Participant, canRemove = false) {
    const fixture = TestBed.createComponent(ParticipantCardComponent);
    fixture.componentRef.setInput('participant', participant);
    fixture.componentRef.setInput('canRemove', canRemove);
    fixture.detectChanges();
    return fixture;
  }

  it('hides the remove action by default', () => {
    expect(render(GUEST).nativeElement.querySelector('.remove-guest-link')).toBeNull();
  });

  it('shows Remove Guest for a removable guest', () => {
    const element = render(GUEST, true).nativeElement as HTMLElement;
    expect(element.querySelector('.remove-guest-link')?.textContent).toContain('Remove Guest');
  });

  it('uses the guest name in the remove button accessible label', () => {
    const button = render(GUEST, true).nativeElement.querySelector('.remove-guest-link') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Remove Alex');
  });

  it('emits the participant selected for removal', () => {
    const fixture = render(GUEST, true);
    let selected: Participant | undefined;
    fixture.componentInstance.removeClick.subscribe((participant) => (selected = participant));

    (fixture.nativeElement.querySelector('.remove-guest-link') as HTMLButtonElement).click();
    expect(selected).toBe(GUEST);
  });

  it('never shows the remove action on the owner card', () => {
    const element = render(OWNER, true).nativeElement as HTMLElement;
    expect(element.querySelector('.remove-guest-link')).toBeNull();
  });
});
