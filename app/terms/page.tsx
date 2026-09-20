export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#fff8f4] px-6 py-16 text-[#2f2018] sm:px-10">
      <article className="mx-auto max-w-2xl">
        <p className="text-sm font-medium text-[#db6f31]">919 기록물 업로드</p>
        <h1 className="mt-3 text-3xl font-semibold">서비스 이용약관</h1>
        <p className="mt-8 leading-7">
          이 페이지는 919 기록물의 원본 파일을 제출하기 위한 전용 업로드 창구입니다. 제출자는
          업로드할 파일을 공유·보관할 권한이 있음을 확인합니다.
        </p>
        <p className="mt-5 leading-7">
          파일은 관리자의 Google Drive에 저장되며, 보관함은 링크를 가진 사람이 열람할 수 있습니다.
          파일 공개 범위와 저작권·초상권 문제를 확인한 뒤 제출해 주세요.
        </p>
        <p className="mt-5 leading-7">
          전송이 중단되면 같은 파일을 다시 선택해 업로드를 이어갈 수 있습니다. 업로드 중에는 브라우저를
          열어 두는 것을 권장합니다.
        </p>
      </article>
    </main>
  );
}
