import { useCallback } from 'react';
import { View } from 'react-native';
import { ExternalTextLink } from '@/components/base/ExternalTextLink';
import { DOCS_URL, WEBSITE_URL } from '@/config';
import { openExternalUrl } from '@/services/externalLinks';
import { ProfileAction } from './shared';

const NINE_R_FRAMEWORK_DOCS_PATH = '/project/9r-framework';
const GLOSSARY_DOCS_PATH = '/user-guides/glossary';

// Signed-in people can no longer see the sign-up and sign-in legal links, so they live here too.
const LEGAL_LINKS = [
  { title: 'Terms', path: '/terms' },
  { title: 'Privacy policy', path: '/privacy' },
  { title: 'Accessibility statement', path: '/accessibility' },
] as const;

// A link row, not a button: on web it is an anchor that opens in a new tab.
function LegalLink({ title, path }: { title: string; path: string }) {
  return (
    <View className="min-h-11 justify-center px-4 py-2.5">
      <ExternalTextLink
        url={WEBSITE_URL ? new URL(path, WEBSITE_URL).toString() : undefined}
        className="font-semibold"
      >
        {title}
      </ExternalTextLink>
    </View>
  );
}

/** Background/links section: the 9R framework the mark's nine nods to, the glossary and the legal pages. */
export function ProfileAboutSection() {
  const openNineRFramework = useCallback(() => {
    if (DOCS_URL) {
      void openExternalUrl(new URL(NINE_R_FRAMEWORK_DOCS_PATH, DOCS_URL).toString());
    }
  }, []);
  const openGlossary = useCallback(() => {
    if (DOCS_URL) {
      void openExternalUrl(new URL(GLOSSARY_DOCS_PATH, DOCS_URL).toString());
    }
  }, []);

  return (
    <View className="mx-1">
      <ProfileAction
        icon="tag"
        title="Glossary"
        subtitle="What the words in R9lab mean, in plain language"
        onPress={openGlossary}
      />
      <ProfileAction
        icon="info"
        title="The 9R framework"
        subtitle="The nine circular-economy strategies behind R9lab"
        onPress={openNineRFramework}
      />
      {WEBSITE_URL ? LEGAL_LINKS.map((link) => <LegalLink key={link.path} {...link} />) : null}
    </View>
  );
}
