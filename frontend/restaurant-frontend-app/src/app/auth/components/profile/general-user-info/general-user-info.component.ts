import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { concatMap, EMPTY, finalize, of, throwError } from 'rxjs';

import { AuthenticationService } from '@app/auth/services/authentication.service';
import { UserModel } from '@app/auth/models/user.model';
import { UsersService } from '@app/services/users/users.service';
import { ToastService } from '@app/services/toast/toast.service';

type ProfileControlName = 'firstName' | 'lastName';

const MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024;
const MAX_PROFILE_IMAGE_DIMENSION = 4096;
const SUPPORTED_PROFILE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

@Component({
  selector: 'app-general-user-info',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: 'general-user-info.component.html',
  styleUrl: 'general-user-info.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GeneralInformationComponent {
  private readonly formBuilder = inject(FormBuilder);
  private readonly authenticationService = inject(AuthenticationService);
  private readonly usersService = inject(UsersService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly user = signal<UserModel | null>(null);
  readonly profileImage = signal<string | null>(null);
  readonly isSaving = signal(false);
  readonly isReadingPhoto = signal(false);

  private photoChanged = false;
  private imageRevision = 0;
  private userRevision = 0;
  private activeReader: FileReader | null = null;
  private savedFirstName = '';
  private savedLastName = '';

  readonly userForm = this.formBuilder.nonNullable.group({
    firstName: [
      '',
      [
        Validators.required,
        Validators.maxLength(50),
        Validators.pattern(/^[A-Za-z'-]+$/),
      ],
    ],
    lastName: [
      '',
      [
        Validators.required,
        Validators.maxLength(50),
        Validators.pattern(/^[A-Za-z'-]+$/),
      ],
    ],
  });

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.imageRevision++;
      this.stopReadingPhoto();
    });

    this.authenticationService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        const userChanged = this.user()?.id !== user?.id;
        this.user.set(user);

        if (userChanged) {
          this.userRevision++;
          this.imageRevision++;
          this.stopReadingPhoto();
          this.photoChanged = false;
          this.profileImage.set(null);
        }

        if (!user) {
          this.savedFirstName = '';
          this.savedLastName = '';
          this.userForm.reset();
          return;
        }

        this.savedFirstName = user.firstName;
        this.savedLastName = user.lastName;
        this.userForm.patchValue({
          firstName: user.firstName,
          lastName: user.lastName,
        });

        if (userChanged) {
          this.loadUserProfileImage(user.id);
        }
      });
  }

  isInvalid(controlName: ProfileControlName): boolean {
    const control = this.userForm.controls[controlName];
    return control.invalid && control.touched;
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';

    if (!file || !this.user()) {
      return;
    }

    if (!SUPPORTED_PROFILE_IMAGE_TYPES.has(file.type)) {
      this.showError('Please select a JPEG, PNG, or WebP image');
      return;
    }

    if (file.size === 0) {
      this.showError('Please select a non-empty image file');
      return;
    }

    if (file.size > MAX_PROFILE_IMAGE_SIZE) {
      this.showError('Image must be 5 MB or smaller');
      return;
    }

    const revision = ++this.imageRevision;
    this.stopReadingPhoto();

    const reader = new FileReader();
    this.activeReader = reader;
    this.isReadingPhoto.set(true);

    reader.onload = () => {
      if (this.activeReader !== reader || revision !== this.imageRevision) {
        return;
      }

      this.activeReader = null;

      if (typeof reader.result !== 'string') {
        this.isReadingPhoto.set(false);
        this.handlePhotoReadError();
        return;
      }

      this.validatePhotoDimensions(reader.result, revision);
    };

    reader.onerror = () => {
      if (this.activeReader !== reader || revision !== this.imageRevision) {
        return;
      }

      this.activeReader = null;
      this.isReadingPhoto.set(false);
      this.handlePhotoReadError();
    };

    reader.readAsDataURL(file);
  }

  onSave(): void {
    if (this.isSaving() || this.isReadingPhoto()) {
      return;
    }

    const user = this.user();
    if (!user) {
      return;
    }

    if (this.userForm.invalid) {
      this.userForm.markAllAsTouched();
      return;
    }

    const { firstName, lastName } = this.userForm.getRawValue();
    const namesChanged =
      firstName !== this.savedFirstName || lastName !== this.savedLastName;
    const imageToUpload = this.photoChanged ? this.profileImage() : null;
    if (!namesChanged && !imageToUpload) {
      return;
    }

    const imageRevision = this.imageRevision;
    const userRevision = this.userRevision;
    let uploadingPhoto = false;
    let namesSaved = false;

    this.isSaving.set(true);

    const profileUpdate$ = namesChanged
      ? this.authenticationService.editProfile(firstName, lastName)
      : of<string | null>(null);

    profileUpdate$
      .pipe(
        concatMap((response) => {
          if (userRevision !== this.userRevision) {
            return EMPTY;
          }

          if (namesChanged && !response) {
            return throwError(() => new Error('Failed to update profile'));
          }

          if (namesChanged) {
            namesSaved = true;
            this.savedFirstName = firstName;
            this.savedLastName = lastName;
          }

          if (!imageToUpload) {
            return of(null);
          }

          uploadingPhoto = true;
          return this.authenticationService.uploadMyProfileImage(imageToUpload);
        }),
        finalize(() => this.isSaving.set(false)),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          if (userRevision !== this.userRevision) {
            return;
          }

          if (imageToUpload && imageRevision === this.imageRevision) {
            this.photoChanged = false;
          }

          this.showSuccess();
        },
        error: (error: unknown) => {
          if (userRevision !== this.userRevision) {
            return;
          }

          if (uploadingPhoto) {
            console.error('Failed to upload profile image', error);
            this.showError(namesSaved
              ? 'Your name changes were saved, but the photo upload failed. Click Save Changes to retry the photo.'
              : 'Failed to upload profile image');
          } else {
            this.showError();
          }
        },
      });
  }

  private loadUserProfileImage(userId: string): void {
    const revision = this.imageRevision;

    this.usersService.getUserProfileImage(userId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (revision !== this.imageRevision || this.photoChanged) {
            return;
          }

          this.profileImage.set(response.presignedUrl);
        },
        error: (error: unknown) => {
          if (revision !== this.imageRevision || this.photoChanged) {
            return;
          }

          console.error('Failed to load profile image', error);
          this.profileImage.set(null);
        },
      });
  }

  private stopReadingPhoto(): void {
    const reader = this.activeReader;
    this.activeReader = null;
    this.isReadingPhoto.set(false);

    if (reader?.readyState === FileReader.LOADING) {
      reader.abort();
    }
  }

  private handlePhotoReadError(
    message = 'Failed to read profile image',
  ): void {
    this.showError(message);

    const user = this.user();
    if (user && !this.photoChanged && !this.profileImage()) {
      this.loadUserProfileImage(user.id);
    }
  }

  private validatePhotoDimensions(dataUrl: string, revision: number): void {
    const image = new Image();

    image.onload = () => {
      if (revision !== this.imageRevision) {
        return;
      }

      this.isReadingPhoto.set(false);

      if (
        image.naturalWidth > MAX_PROFILE_IMAGE_DIMENSION ||
        image.naturalHeight > MAX_PROFILE_IMAGE_DIMENSION
      ) {
        this.showError('Image dimensions must not exceed 4096 × 4096 pixels');
        return;
      }

      this.photoChanged = true;
      this.profileImage.set(dataUrl);
    };

    image.onerror = () => {
      if (revision !== this.imageRevision) {
        return;
      }

      this.isReadingPhoto.set(false);
      this.handlePhotoReadError('Please select a valid image file');
    };

    image.src = dataUrl;
  }

  private showSuccess(): void {
    this.toastService.success('Profile updated successfully', 'Success');
  }

  private showError(message = 'Failed to update profile'): void {
    this.toastService.error(message, 'Error');
  }
}
