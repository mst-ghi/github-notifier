import { errorMessage } from '../shared/errors';
import type { ProfileOverview } from '../shared/types';
import type { GithubApi } from './github-api';
import { childLogger } from './logger';

const log = childLogger('profile');

/**
 * Everything the profile page needs, in one call.
 *
 * The two pull-request queries go through the search API, which spans every
 * repository the token can see rather than only the watched ones — that is the
 * point of the page: what is on your plate right now, wherever it lives.
 *
 * Search has its own small quota (30 requests a minute), so this is two queries
 * and no more, and a failure in one does not lose the other.
 */
export async function getProfileOverview(github: GithubApi): Promise<ProfileOverview> {
  const empty: ProfileOverview = {
    user: null,
    authored: [],
    reviewRequested: [],
    scopes: [],
    rateLimit: null,
    error: null,
  };

  if (!github.isReady) {
    return { ...empty, error: 'Add a GitHub token in Settings to see your profile.' };
  }

  try {
    const validation = await github.validateToken();
    const user = await github.getProfile();

    const [authored, reviewRequested] = await Promise.all([
      github
        .searchPullRequests(`is:open is:pr author:${user.login} archived:false`)
        .catch((error: unknown) => {
          log.warn({ err: errorMessage(error) }, 'authored search failed');
          return [];
        }),
      github
        .searchPullRequests(`is:open is:pr review-requested:${user.login} archived:false`)
        .catch((error: unknown) => {
          log.warn({ err: errorMessage(error) }, 'review-requested search failed');
          return [];
        }),
    ]);

    return {
      user,
      authored,
      reviewRequested,
      scopes: validation.scopes,
      rateLimit: github.queue.info,
      error: null,
    };
  } catch (error) {
    const message = errorMessage(error);
    log.error({ err: message }, 'could not load the profile');
    return { ...empty, error: message };
  }
}
